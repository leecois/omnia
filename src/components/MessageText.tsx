import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export default function MessageText({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Open links in a new tab safely
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
        // Inline paragraphs so they don't cause layout shifts in message rows
        p: ({ children }) => <span className="md-p">{children}</span>,
        // Code blocks
        pre: ({ children }) => <pre className="md-pre">{children}</pre>,
        code: ({ children, className }) =>
          className ? (
            <code className={className}>{children}</code>
          ) : (
            <code className="md-code-inline">{children}</code>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
