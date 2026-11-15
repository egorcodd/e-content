import type { ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text
    .split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
    .map((part, index) => {
      if (part.startsWith('**')) return <strong key={index}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('`')) return <code key={index}>{part.slice(1, -1)}</code>;
      const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      return link ? (
        <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">
          {link[1]}
        </a>
      ) : (
        part
      );
    });
}

export function MarkdownView({ body }: { body: string }) {
  const blocks = body.replace(/\r\n/g, '\n').split(/(```[\s\S]*?```)/g);
  return (
    <div className="mp-markdown">
      {blocks.flatMap((block, blockIndex) => {
        if (block.startsWith('```'))
          return (
            <pre key={blockIndex}>
              <code>{block.replace(/^```[^\n]*\n?/, '').replace(/```$/, '')}</code>
            </pre>
          );
        return block
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map((paragraph, index) => {
            const key = `${blockIndex}-${index}`;
            const heading = paragraph.match(/^(#{1,3})\s+(.+)$/);
            if (heading)
              return heading[1].length === 1 ? (
                <h2 key={key}>{inline(heading[2])}</h2>
              ) : heading[1].length === 2 ? (
                <h3 key={key}>{inline(heading[2])}</h3>
              ) : (
                <h4 key={key}>{inline(heading[2])}</h4>
              );
            if (paragraph.split('\n').every((line) => /^[-*]\s/.test(line)))
              return (
                <ul key={key}>
                  {paragraph.split('\n').map((line, row) => (
                    <li key={row}>{inline(line.slice(2))}</li>
                  ))}
                </ul>
              );
            if (paragraph.startsWith('> '))
              return <blockquote key={key}>{inline(paragraph.replace(/^> /gm, ''))}</blockquote>;
            return <p key={key}>{inline(paragraph)}</p>;
          });
      })}
    </div>
  );
}
