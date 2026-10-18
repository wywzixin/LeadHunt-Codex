"use client";

import { Loader2 } from "lucide-react";

type TableLoadingStateProps = {
  title?: string;
  description?: string;
  compact?: boolean;
};

export function TableLoadingState({
  title = "正在加载数据",
  description = "接口返回后会自动更新列表。",
  compact = false
}: TableLoadingStateProps) {
  return (
    <div className={compact ? "tableLoadingState compact" : "tableLoadingState"} role="status" aria-live="polite">
      <span className="tableLoadingSpinner" aria-hidden="true">
        <Loader2 size={24} />
      </span>
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
