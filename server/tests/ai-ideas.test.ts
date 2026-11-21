import { indexResponse } from './semantic-index-fixture.ts';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AiIdeaAnalysis } from '../ai-ideas.ts';
import { LocalStore } from '../store.ts';
import type { CollectionRun } from '../../src/features/collection/contracts.ts';
import { configuration, fixture, finish } from './fixtures.ts';
import { FixtureTikTokReader, tiktokConfiguration } from './tiktok-worker-fixture.ts';

test('full cycle sends one request after collection, publishes evidence, and reuses the result', async (t) => {
  const transport = globalThis.fetch;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: Parameters<typeof fetch>[0], options?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return transport(url, options);
    calls++;
    const rows = JSON.parse(JSON.parse(String(options?.body)).input) as { id: string; text: string }[];
    assert.equal(rows.length, 3);
    const ideas = [{ title: 'Тема ролика', angle: 'План', evidence: rows.map(r => r.id) }];
    return Response.json({ status: 'completed', usage: {input_tokens: 200, output_tokens: 50},
      output: [{ type: 'message', content: [{ type: 'output_text', text: indexResponse(ideas) }] }] });
  });
  const f = await fixture({ tiktokReaderFactory: () => new FixtureTikTokReader() });
  try {
    f.app.store.setSecret('openai-api-key', 'fixture');
    await f.request('/connections');
    for (const [id, mode] of [['auto-ideas-full-cycle','cycle'], ['auto-ideas-reuse','orchestrator']]) {
      const result = await f.request('/collection/runs', 'POST', { id, mode, configuration: tiktokConfiguration() });
      assert.equal(result.status, 202);
      const run = await finish(f.app, id);
      assert.equal(run.status, 'completed', run.error);
      assert.equal(run.counts.ideas, 1);
      assert.deepEqual(run.aiUsage, mode === 'cycle' ? {input: 200, output: 50} : {input: 0, output: 0});
      assert.equal(f.app.store.ideas(id).length, 0);
    }
    const { data } = await f.request('/collection/ai-materials');
    assert.equal(data.ideas.length, 1);
    assert.ok(data.ideas[0].evidence.length >= 2);
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test('a standalone Telegram run publishes a linked post and skips both analytics and TikTok', async t => {
  const local = globalThis.fetch;
  let requests = 0;
  t.mock.method(globalThis,'fetch',async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return local(url,init);
    const rows = JSON.parse(JSON.parse(String(init?.body)).input) as {id:string; kind:string; text:string}[];
    const post = rows.find(r=>r.kind === 'post')!;
    requests++;
    const ideas = [{title:'Как проверить качество тестов',angle:'Практика',evidence:[post.id]}];
    return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:20},output:[
      {type:'message',content:[{type:'output_text',text:indexResponse(ideas)}]}]});
  });
  const f = await fixture();
  try {
    await f.login();
    f.app.store.setSecret('openai-api-key','fixture');
    const id = 'telegram-only-materials';
    await f.request('/collection/runs','POST',{id,mode:'telegram',configuration:configuration()});
    const run = await finish(f.app,id);
    assert.equal(run.status,'completed',run.error);
    assert.equal(requests,1);
    assert.ok(run.done.includes('materials') && run.done.includes('orchestrator'));
    assert.ok(run.skipped.includes('analytics') && run.skipped.includes('tiktok'));
    const [card] = (await f.request('/collection/ai-materials')).data.ideas;
    assert.equal(card.format,'post');
    assert.match(card.evidence[0].url,/^https:\/\/t\.me\/fixture_channel\/\d+$/);
    assert.deepEqual((await f.request('/analytics/history')).data.telegram,[]);
  } finally { await f.close(); }
});

test('saved analysis verifies quotes and independent threads, and reuses the result', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ec-ai-'));
  const store = new LocalStore(directory);
  try {
    const run: CollectionRun = {
      id: 'saved-fixture',
      status: 'completed',
      done: [],
      skipped: [],
      events: [],
      active: null,
      steps: {},
      ideas: [],
      startedAt: '',
      updatedAt: '',
      counts: { posts: 1, comments: 3, ideas: 0, requests: 0 },
    };
    store.saveRun(run);
    const texts = [
      'Как подтвердить опыт работы на проекте без трудовой?',
      'На собеседовании тоже спросили трудовую.',
      'На проверке приняли мой договор после подозрения в накрутке опыта.',
    ];
    texts.forEach((text, i) =>
      store.addRecord(run.id, {
        id: String(i + 1),
        sourceId: 'p',
        publicationId: 'vid',
        videoId: 'vid',
        purpose: 'own',
        kind: 'comment',
        platform: 'tiktok',
        publishedAt: null,
        text,
        url: 'https://www.tiktok.com/',
        parentId: i === 1 ? '1' : undefined,
      }),
    );
    let calls = 0;
    let rejectKey = true;
    const ai = new AiIdeaAnalysis(store, async (url, init) => {
      if (rejectKey) return new Response(null, { status: 401 });
      calls++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      const requestBody = JSON.parse(String(init?.body));
      assert.equal(requestBody.store, false);
      assert.deepEqual(
        JSON.parse(requestBody.input).map((r: { text: string }) => r.text),
        texts,
      );
      const evidence = texts.map((_, i) => 'c' + (i + 1));
      const ideas = [
        { title: 'Чем подтвердить опыт', angle: 'Реальные документы', evidence },
        { title: 'Повторы', angle: 'Одна ветка', evidence: evidence.slice(0, 2) },
        {
          title: 'Ошибка',
          angle: 'Чужая цитата',
          evidence: [evidence[0], 'c999'],
        },
      ];
      return Response.json({
        status: 'completed',
        usage: { input_tokens: 100, output_tokens: 40 },
        output: [
          { type: 'message', content: [{ type: 'output_text', text: indexResponse(ideas) }] },
        ],
      });
    });
    await assert.rejects(ai.analyze(run.id), { code: 'AI_KEY' });
    store.setSecret('openai-api-key', 'fixture');
    await assert.rejects(ai.analyze(run.id), { code: 'AI_REQUEST_REJECTED' });
    rejectKey = false;
    const [result, concurrent] = await Promise.all([ai.analyze(run.id), ai.analyze(run.id)]);
    assert.deepEqual(result, concurrent);
    assert.deepEqual(
      result.ideas.map((i) => [i.title, i.evidence.map((e) => e.id)]),
      [['Чем подтвердить опыт', ['1', '2', '3']]],
    );
    assert.deepEqual(
      result.ideas[0].evidence.map((e) => e.quote),
      texts,
    );
    assert.deepEqual(await ai.analyze(run.id), JSON.parse(JSON.stringify(result)));
    const later = { ...run, id: 'second-saved-fixture' };
    store.saveRun(later);
    for (const record of store.records(run.id).reverse()) store.addRecord(later.id, record);
    assert.deepEqual(await ai.analyze(later.id), JSON.parse(JSON.stringify(result)));
    assert.equal(calls, 1);
    assert.ok(ai.materialsVersion());
    const cards = ai.materials();
    assert.equal(cards.length, 1);
    assert.equal(cards[0].format, 'video');
    assert.equal(cards[0].title, result.ideas[0].title);
    assert.deepEqual(cards[0].evidence.map(item => item.text), texts);
    assert.equal(store.run(run.id)?.counts.ideas, 0);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});


test('a paraphrase extends the existing topic with one verified quote; a different question gets a new card', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ec-topic-'));
  const store = new LocalStore(directory);
  const run: CollectionRun = {
    id: 'first-topic', status: 'completed', done: [], skipped: [], events: [], active: null,
    steps: {}, ideas: [], startedAt: '', updatedAt: '', counts: {posts: 0, comments: 0, ideas: 0, requests: 0},
  };
  try {
    store.saveRun(run);
    const original = {title: 'Как выбрать IT-направление', angle: 'Сравнение направлений по интересам',
      evidence: ['a','b'].map(id => ({id, source:'tiktok',kind:'comment',text:'Как выбрать?',url:'https://example.org/'+id}))};
    store.db.prepare('INSERT INTO ai_idea_reports VALUES (?,?,?)').run(run.id,'initial',
      JSON.stringify({ideas:[original],comments:2,usage:{input:10,output:2}}));
    const next = 'second-topic';
    store.saveRun({...run,id:next});
    const texts = ['Что из специальностей выбрать по интересам?', 'Как войти в безопасность с нуля?', 'С чего начинают в AppSec?'];
    texts.forEach((text,i) => store.addRecord(next, {id:'new-'+i,sourceId:'profile',publicationId:'vid',
      videoId:'vid',purpose:'own',kind:'comment',platform:'tiktok',text,publishedAt:null,url:'https://example.org/'+i}));
    store.setSecret('openai-api-key','fixture');
    let calls = 0;
    const ai = new AiIdeaAnalysis(store, async (_url, init) => {
      calls++;
      const {topics,comments} = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.equal(topics.length,1);
      assert.equal(topics[0].angle,original.angle);
      assert.deepEqual(comments.map((r:{text:string})=>r.text),texts);
      const refs = comments.map((r:{id:string;text:string})=>r.id);
      const ideas = [
        {title:'Куда идти в IT',angle:'Подбор специализации',evidence:[refs[0],refs[0]]},
        {topicId:null,title:'С чего начать в AppSec',angle:'Первые практические шаги',evidence:refs.slice(1)},
      ];
      return Response.json({status:'completed',usage:{input_tokens:45,output_tokens:17},
        output:[{type:'message',content:[{type:'output_text',text:indexResponse(ideas,[{idea:1,topicId:topics[0].topicId,answerQuote:topics[0].angle}])}]}]});
    });
    const [before] = ai.materials();
    await ai.analyze(next);
    await ai.analyze(next);
    const cards = ai.materials();
    assert.equal(calls,1);
    assert.equal(cards.length,2);
    assert.equal(cards[0].id,before.id);
    assert.equal(cards[0].title,original.title);
    assert.deepEqual(cards[0].evidence.map(e=>e.id),['a','b','new-0']);
    assert.equal(cards[1].title,'С чего начать в AppSec');
    assert.equal(cards[1].evidence.length,2);
  } finally {
    store.close();
    rmSync(directory,{recursive:true,force:true});
  }
});


test('TikTok review restores the parent from an older run without making it evidence or importing review suggestions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ec-review-'));
  const store = new LocalStore(directory);
  try {
    const run: CollectionRun = {id:'old',status:'completed',done:[],skipped:[],events:[],active:null,
      steps:{},ideas:[],startedAt:'',updatedAt:'',counts:{posts:0,comments:0,ideas:0,requests:0}};
    store.saveRun(run);
    store.saveRun({...run,id:'selected'});
    const base = {platform:'tiktok',kind:'comment',sourceId:'account',publicationId:'video',videoId:'video',
      purpose:'own',publishedAt:null,url:'https://example.org/'} as const;
    store.addRecord('old',{...base,id:'root',text:'Как выбирают язык для проекта?'});
    store.addRecord('old',{...base,id:'different',text:'Чужой контекст',publicationId:'another'});
    store.addRecord('selected',{...base,id:'a',text:'Зависит от цели проекта',parentId:'root'});
    store.addRecord('selected',{...base,id:'b',text:'Что выбрать для прототипа?',parentId:'different'});
    store.addRecord('selected',{...base,id:'extra',text:'Вошло в сбор, но не в исходную выборку'});
    store.db.prepare('INSERT INTO ai_idea_reports VALUES (?,?,?)').run('selected','original',
      JSON.stringify({comments:2,ideas:[],usage:{input:12,output:4}}));
    for (const id of ['a','b']) store.db.prepare('INSERT INTO ai_idea_inputs VALUES (?,?)').run(id,'selected');
    store.setSecret('openai-api-key','fixture');
    let calls = 0;
    const ai = new AiIdeaAnalysis(store,async (_url,init) => {
      calls++;
      const rows = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.equal(rows.length,2);
      assert.deepEqual(rows[0].context,['Как выбирают язык для проекта?']);
      assert.equal(rows[1].context,undefined);
      const ideas = [
        {topicId:null,title:'Тема',angle:'План',evidence:rows.map((r:{id:string;text:string})=>r.id)},
        {topicId:null,title:'Чужая цитата',angle:'План',evidence:[
          'parent-c1','c2']},
      ];
      return Response.json({status:'completed',usage:{input_tokens:20,output_tokens:3},
        output:[{type:'message',content:[{type:'output_text',text:indexResponse(ideas)}]}]});
    });
    // A blind replay must not see even an existing material whose wording suggests the answer.
    const originalTitle = 'Уже сохранённая подсказка';
    store.db.prepare('INSERT INTO ai_idea_reports VALUES (?,?,?)').run('old','older',
      JSON.stringify({comments:0,ideas:[{topicId:'known',title:originalTitle,angle:'Подсказка',evidence:[]}]}));
    const review = await ai.reviewSavedTikTokInputs('selected',{blind:true});
    assert.deepEqual(review.ideas.map(i=>i.title),['Тема']);
    assert.deepEqual(await ai.reviewSavedTikTokInputs('selected',{blind:true}),JSON.parse(JSON.stringify(review)));
    assert.equal(calls,1);
    assert.deepEqual(ai.materials().map(c=>c.title),[originalTitle]);
    const before = ai.materialsVersion();
    const receipt = String(store.db.prepare('SELECT fingerprint FROM ai_idea_reviews WHERE run_id=?').get('selected')!.fingerprint);
    assert.throws(() => ai.publishReviewedIdea(receipt,'unknown'),{code:'AI_REVIEW'});
    ai.publishReviewedIdea(receipt,review.ideas[0].topicId!);
    const published = ai.materialsVersion();
    assert.notEqual(before,published);
    ai.publishReviewedIdea(receipt,review.ideas[0].topicId!);
    assert.equal(ai.materialsVersion(),published);
    assert.deepEqual(ai.materials().map(card => [card.title,card.evidence.map(e=>e.id)]),[[originalTitle,[]],['Тема',['a','b']]]);
    assert.equal(calls,1);
    assert.deepEqual(ai.saved('selected')?.report.usage,{input:12,output:4});
  } finally { store.close(); rmSync(directory,{recursive:true,force:true}); }
});


test('a new mechanism inside a reply needs independent threads, and a broad catalog suggestion needs support in its plan', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'ec-mechanism-'));
  const store = new LocalStore(directory);
  const broad = 'tiktok-ai-maintenance';
  const run: CollectionRun = {id:'original',status:'completed',done:[],skipped:[],events:[],active:null,
    steps:{},ideas:[],startedAt:'',updatedAt:'',counts:{posts:1,comments:0,ideas:0,requests:0}};
  try {
    store.saveRun(run);
    store.db.prepare('INSERT INTO ai_idea_reports VALUES (?,?,?)').run(run.id,'base',JSON.stringify({
      ideas:[{topicId:broad,title:'Обслуживание велосипеда',angle:'Как составить календарь обслуживания',evidence:[]}]}));
    store.setSecret('openai-api-key','fixture');
    const base = {platform:'tiktok',kind:'comment',sourceId:'profile',publicationId:'v',videoId:'v',
      purpose:'own',publishedAt:null,url:'https://example.org/'} as const;
    let calls = 0;
    const ai = new AiIdeaAnalysis(store,async (_url, init) => {
      calls++;
      const {comments} = JSON.parse(JSON.parse(String(init?.body)).input);
      assert.deepEqual(comments.map((r:{id:string}) => r.id),['c1','c1.2','c2']);
      const output = {
        ideas:[
          {title:'Почему на спуске падает сила торможения?',angle:'Проверить при длительной нагрузке'},
          {title:'Почему после остывания тормоз работает?',angle:'Сравнить поведение до и после'},
        ],
        assignments:[{passage:'c1.2',ideas:[1]},{passage:'c2',ideas:[2]}],
        mechanisms:[
          {title:'Как нагрев влияет на тормоза?',angle:'Сопоставить симптомы нагрева и охлаждения',
            members:[1,2],passages:['c1','c1.2','c1.2','c2','unknown']},
          {title:'Несуществующее подтверждение',angle:'План',members:[1,999],passages:['c1.2','c2']},
        ],
        matches:[{idea:3,topicId:broad,answerQuote:'Перегрев колодок при длительном торможении'}],
      };
      return Response.json({status:'completed',usage:{input_tokens:90,output_tokens:40},output:[
        {type:'message',content:[{type:'output_text',text:JSON.stringify(output)}]}]});
    });
    const texts = ['Цепь обслужил вчера. На длинном спуске колодки перестают держать.', 'После охлаждения тормоза снова схватывают.'];
    for (const [id, roots] of [['one',['thread','thread']],['two',['branch-a','branch-b']]] as const) {
      store.saveRun({...run,id});
      texts.forEach((text,i)=>store.addRecord(id,{...base,id:id+i,text,parentId:roots[i]}));
      const result = await ai.analyze(id);
      if (id === 'one') assert.equal(result.ideas.length,0);
      else {
        assert.equal(result.ideas.length,1);
        assert.notEqual(result.ideas[0].topicId,broad);
        assert.deepEqual(result.ideas[0].evidence.map(e=>e.quote),['На длинном спуске колодки перестают держать.',texts[1]]);
      }
    }
    assert.equal(calls,2);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});


test('ambiguous citations do not dilute a topic with two independent direct witnesses; exclusive paraphrases survive', async () => {
  const directory = mkdtempSync(join(tmpdir(),'ec-citations-'));
  const store = new LocalStore(directory);
  try {
    const run: CollectionRun = {id:'citations',status:'completed',done:[],skipped:[],events:[],active:null,
      steps:{},ideas:[],startedAt:'',updatedAt:'',counts:{posts:1,comments:5,ideas:0,requests:0}};
    store.saveRun(run);
    const texts = ['Калибровка дисплея сбрасывается?', 'У меня тоже слетает калибровка.',
      'Да, бывает и такое.', 'После выключения опять странные цвета.', 'Зависает загрузчик после обновления.'];
    texts.forEach((text,i) => store.addRecord(run.id,{id:String(i),sourceId:'p',publicationId:'v',videoId:'v',
      platform:'tiktok',kind:'comment',purpose:'own',url:'https://example.org/',publishedAt:null,text}));
    store.setSecret('openai-api-key','fixture');
    const ai = new AiIdeaAnalysis(store,async()=>Response.json({status:'completed',output:[{type:'message',content:[
      {type:'output_text',text:indexResponse([
        {title:'Почему сбрасывается калибровка?',angle:'Проверить профиль дисплея',evidence:['c1','c2','c3','c4']},
        {title:'Почему зависает загрузчик?',angle:'Обновления',evidence:['c3','c5']},
      ])},
    ]}]}));
    const result = await ai.analyze(run.id);
    assert.deepEqual(result.ideas.find(i=>i.title.includes('калибровка'))?.evidence.map(e=>e.text),[texts[0],texts[1],texts[3]]);
  } finally {store.close();rmSync(directory,{recursive:true,force:true});}
});

test('analytics finishes on an AI rejection and the next click resumes the saved texts only', async t => {
  const local = globalThis.fetch;
  let posts = 0;
  t.mock.method(globalThis,'fetch',async (url: Parameters<typeof fetch>[0],init?: RequestInit) => {
    if (String(url) !== 'https://api.openai.com/v1/responses') return local(url,init);
    if (++posts === 1) return new Response(null,{status:403});
    return Response.json({status:'completed',usage:{input_tokens:30,output_tokens:2},
      output:[{type:'message',content:[{type:'output_text',text:indexResponse([])}]}]});
  });
  const f = await fixture();
  try {
    await f.login();
    f.app.store.setSecret('openai-api-key','fixture');
    const config = configuration();
    const id = 'checkpoint-after-sources';
    await f.request('/collection/runs','POST',{id,mode:'cycle',configuration:config});
    const first = await finish(f.app,id);
    assert.equal(first.status,'partial');
    assert.ok(first.failures?.ideas);
    assert.ok(first.done.includes('analytics'));
    const consumed = [...f.gateway.calls];
    const resumed = await f.request('/collection/runs','POST',{id:'new-click-result-only',mode:'cycle',configuration:config});
    assert.equal(resumed.status,202);
    const final = await finish(f.app,id);
    assert.equal(final.status,'completed',final.error);
    assert.deepEqual(final.aiUsage,{input:30,output:2});
    assert.ok(final.done.includes('materials') && final.done.includes('orchestrator'));
    assert.deepEqual(f.gateway.calls,consumed);
    assert.equal(posts,2);
  } finally {await f.close();}
});
