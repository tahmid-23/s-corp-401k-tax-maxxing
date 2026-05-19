import ReactMarkdown from "react-markdown";
import explainerMd from "../content/explainer.md?raw";

export function Explainer() {
  return (
    <article className="mt-24 pt-14 border-t-2 border-ink/20 max-w-3xl mx-auto">
      <div className="prose-paper">
        <ReactMarkdown
          components={{
            h2: ({ children }) => (
              <h2 className="display text-3xl leading-tight mt-2 mb-7 text-ink">
                {children}
              </h2>
            ),
            h3: ({ children }) => (
              <h3 className="display text-xl mt-10 mb-3 text-ink">
                {children}
              </h3>
            ),
            p: ({ children }) => (
              <p className="text-ink-soft leading-relaxed mb-5">{children}</p>
            ),
            ul: ({ children }) => (
              <ul className="list-disc list-outside ml-6 mb-5 space-y-1.5 text-ink-soft">
                {children}
              </ul>
            ),
            li: ({ children }) => (
              <li className="leading-relaxed">{children}</li>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-ink">{children}</strong>
            ),
            em: ({ children }) => <em className="italic">{children}</em>,
            a: ({ href, children }) => (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent transition-colors"
              >
                {children}
              </a>
            ),
            code: ({ children }) => (
              <code className="font-mono text-[0.875em] px-1 bg-paper-deep rounded-sm">
                {children}
              </code>
            ),
          }}
        >
          {explainerMd}
        </ReactMarkdown>
      </div>
    </article>
  );
}
