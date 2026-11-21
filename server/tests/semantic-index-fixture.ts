export function indexResponse(
  ideas: {title:string; angle:string; evidence:string[]}[],
  matches: {idea:number;topicId:string;answerQuote:string}[] = [],
) {
  return JSON.stringify({
    ideas: ideas.map(({title,angle}) => ({title,angle})),
    assignments: ideas.flatMap(({evidence}, i) => evidence.map(passage => ({passage, ideas:[i+1]}))),
    mechanisms: [],
    matches,
  });
}
