import { BrainIcon } from "lucide-react";
import { memo } from "react";

import ChatMarkdown from "../ChatMarkdown";

/**
 * Fork: the agent's reasoning right before it asked, shown above the question
 * so the options arrive with the context the agent wrote for them.
 */
export const QuestionLeadIn = memo(function QuestionLeadIn({ text }: { text: string }) {
  return (
    <div className="mb-2 flex gap-2 border-border/70 border-b pb-2" data-question-lead-in>
      <BrainIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-icon-muted" />
      <ChatMarkdown
        text={text}
        cwd={undefined}
        className="min-w-0 flex-1 text-muted-foreground text-sm"
        lineBreaks
      />
    </div>
  );
});
