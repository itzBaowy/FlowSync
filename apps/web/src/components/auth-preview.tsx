import { ArrowUpRight, Check, Circle, FolderKanban, Sparkles } from 'lucide-react';
import { authCopy as copy } from '@/data/mockData';
interface AuthPreviewProps {
  readonly children?: never;
}
export function AuthPreview(_props: AuthPreviewProps) {
  return (
    <div aria-hidden="true" className="relative mt-10 w-full max-w-md">
      <div className="relative rounded-2xl border border-border bg-card p-5 shadow-xl shadow-primary/5">
        <div className="mb-5 flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs font-semibold">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FolderKanban size={16} />
            </span>
            {copy.previewTitle}
          </span>
          <ArrowUpRight size={15} className="text-muted-foreground" />
        </div>
        <div className="mb-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 rounded-full bg-muted">
            <div className="h-full w-2/3 rounded-full bg-primary" />
          </div>
          <Sparkles size={14} className="text-primary" />
        </div>
        <div className="space-y-2">
          {copy.previewTasks.map((text, index) => (
            <div
              key={text}
              className="flex items-center gap-3 rounded-lg border border-border bg-background/60 px-3 py-3"
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full ${index === 0 ? 'bg-success/15 text-success' : index === 1 ? 'bg-primary/10 text-primary' : 'text-muted-foreground/50'}`}
              >
                {index === 0 ? <Check size={12} /> : <Circle size={14} />}
              </span>
              <span
                className={`flex-1 text-[11px] ${index === 0 ? 'text-muted-foreground line-through' : 'text-foreground'}`}
              >
                {text}
              </span>
              <span
                className={`size-1.5 rounded-full ${index === 0 ? 'bg-success' : 'bg-primary/40'}`}
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-4">
          <span className="size-1.5 rounded-full bg-success" />
          <span className="text-[9px] font-medium tracking-wider text-muted-foreground">
            {copy.previewLabel}
          </span>
        </div>
      </div>
    </div>
  );
}
