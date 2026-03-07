"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Props {
  content: string;
  isUser?: boolean;
}

export default function AiMarkdown({ content, isUser }: Props) {
  if (isUser) {
    return <span className="whitespace-pre-wrap break-words">{content}</span>;
  }

  return (
    <div className="ai-markdown whitespace-pre-wrap break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-2 -mx-1">
              <table className="w-full text-xs border-collapse border border-gray-300 rounded">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-orange-50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="border border-gray-300 px-2 py-1.5 text-left font-semibold text-gray-700 text-xs">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-gray-300 px-2 py-1.5 text-xs">{children}</td>
          ),
          tr: ({ children }) => (
            <tr className="even:bg-gray-50">{children}</tr>
          ),
          // Headers
          h1: ({ children }) => (
            <h3 className="font-bold text-sm mt-2 mb-1">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="font-bold text-sm mt-2 mb-1">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="font-semibold text-sm mt-2 mb-1">{children}</h4>
          ),
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-sm leading-relaxed">{children}</li>
          ),
          // Paragraphs
          p: ({ children }) => (
            <p className="mb-1.5 last:mb-0 leading-relaxed">{children}</p>
          ),
          // Bold / italic
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          // Code
          code: ({ children }) => (
            <code className="bg-gray-200 px-1 py-0.5 rounded text-xs font-mono">{children}</code>
          ),
          // Horizontal rule
          hr: () => <hr className="my-2 border-gray-300" />,
          // Links
          a: ({ href, children }) => (
            <a href={href} className="text-orange-600 underline hover:text-orange-700" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
