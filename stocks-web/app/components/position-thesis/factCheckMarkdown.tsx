import type { ReactNode } from 'react';
import type { Components } from 'react-markdown';

function markdownChildrenToString(children: ReactNode): string {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(markdownChildrenToString).join('');
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const p = (children as { props?: { children?: ReactNode } }).props;
    if (p && 'children' in p) return markdownChildrenToString(p.children);
  }
  return '';
}

type FactSectionTone = 'confirm' | 'unclear' | 'concern' | 'neutral';

/** Map heading text to highlight tone (order: concern > unclear > confirm). */
export function factCheckHeadingTone(raw: string): FactSectionTone {
  const t = raw.toLowerCase().trim();
  if (!t) return 'neutral';
  if (
    /concern|inconsisten|contradict|conflict|misstat|incorrect|does not match|not supported|contrary to|disput|factual error|appears wrong|may be wrong/i.test(
      t
    )
  ) {
    return 'concern';
  }
  if (
    /unclear|could not verify|unverified|insufficient|not found|limited data|unable to confirm|cannot verify|inconclusive|unknown from search/i.test(
      t
    )
  ) {
    return 'unclear';
  }
  if (
    /verif|confirm|consistent|align|match(?:es)?|supported|accurate|checks out|appears correct|corroborat|in line with|aligns with/i.test(
      t
    )
  ) {
    return 'confirm';
  }
  return 'neutral';
}

const sectionBar: Record<FactSectionTone, string> = {
  confirm:
    'mt-3 mb-2 border-l-[3px] border-emerald-500 bg-emerald-50/95 pl-3 py-2 pr-2 rounded-r-md text-[13px] font-semibold text-emerald-950 shadow-sm',
  unclear:
    'mt-3 mb-2 border-l-[3px] border-amber-500 bg-amber-50/95 pl-3 py-2 pr-2 rounded-r-md text-[13px] font-semibold text-amber-950 shadow-sm',
  concern:
    'mt-3 mb-2 border-l-[3px] border-rose-500 bg-rose-50/95 pl-3 py-2 pr-2 rounded-r-md text-[13px] font-semibold text-rose-950 shadow-sm',
  neutral:
    'mt-3 mb-2 border-l-[3px] border-slate-300 bg-slate-50/90 pl-3 py-2 pr-2 rounded-r-md text-[13px] font-semibold text-slate-900',
};

export const factCheckMarkdownComponents: Components = {
  h2({ children, ...props }) {
    const text = markdownChildrenToString(children);
    if (text.trim().toLowerCase() === 'fact check') {
      return (
        <h2
          {...props}
          className="text-[14px] font-bold tracking-tight text-emerald-900 border-b border-emerald-200/80 pb-2 mb-1 mt-0"
        >
          {children}
        </h2>
      );
    }
    const tone = factCheckHeadingTone(text);
    return (
      <h2 {...props} className={sectionBar[tone]}>
        {children}
      </h2>
    );
  },
  h3({ children, ...props }) {
    const text = markdownChildrenToString(children);
    const tone = factCheckHeadingTone(text);
    return (
      <h3 {...props} className={sectionBar[tone]}>
        {children}
      </h3>
    );
  },
  h4({ children, ...props }) {
    const text = markdownChildrenToString(children);
    const tone = factCheckHeadingTone(text);
    return (
      <h4 {...props} className={`${sectionBar[tone]} text-[12.5px] font-semibold`}>
        {children}
      </h4>
    );
  },
  ul({ children, ...props }) {
    return (
      <ul {...props} className="list-disc pl-5 my-1.5 space-y-0.5 text-slate-800">
        {children}
      </ul>
    );
  },
  ol({ children, ...props }) {
    return (
      <ol {...props} className="list-decimal pl-5 my-1.5 space-y-0.5 text-slate-800">
        {children}
      </ol>
    );
  },
  blockquote({ children, ...props }) {
    return (
      <blockquote
        {...props}
        className="my-2 border-l-4 border-slate-300 bg-slate-100/70 pl-3 py-1.5 pr-2 rounded-r text-[12.5px] text-slate-700 italic"
      >
        {children}
      </blockquote>
    );
  },
  p({ children, ...props }) {
    return (
      <p {...props} className="my-1.5 text-[13px] leading-relaxed text-slate-800 first:mt-0 last:mb-0">
        {children}
      </p>
    );
  },
  strong({ children, ...props }) {
    return (
      <strong {...props} className="font-semibold text-slate-900">
        {children}
      </strong>
    );
  },
};
