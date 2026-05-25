"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import {
  AlertCircle,
  CheckCircle2,
  Info,
  TriangleAlert,
  X
} from "lucide-react";

type AppMessageType = "success" | "error" | "info" | "warning";

type AppMessageOptions = {
  description?: string;
  duration?: number;
};

type AppMessageItem = {
  id: number;
  type: AppMessageType;
  title: string;
  description?: string;
};

type AppMessageApi = {
  success: (title: string, options?: AppMessageOptions) => void;
  error: (title: string, options?: AppMessageOptions) => void;
  info: (title: string, options?: AppMessageOptions) => void;
  warning: (title: string, options?: AppMessageOptions) => void;
};

const noopMessageApi: AppMessageApi = {
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warning: () => undefined
};

const AppMessageContext = createContext<AppMessageApi | null>(null);

export function AppMessageProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<AppMessageItem[]>([]);
  const nextIdRef = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const remove = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const show = useCallback(
    (type: AppMessageType, title: string, options: AppMessageOptions = {}) => {
      const id = nextIdRef.current;
      nextIdRef.current += 1;
      const duration = options.duration ?? 3000;

      setMessages((current) => [
        ...current.slice(-2),
        {
          id,
          type,
          title,
          description: options.description
        }
      ]);

      if (duration > 0) {
        const timer = window.setTimeout(() => remove(id), duration);
        timersRef.current.set(id, timer);
      }
    },
    [remove]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const api = useMemo<AppMessageApi>(
    () => ({
      success: (title, options) => show("success", title, options),
      error: (title, options) => show("error", title, options),
      info: (title, options) => show("info", title, options),
      warning: (title, options) => show("warning", title, options)
    }),
    [show]
  );

  return (
    <AppMessageContext.Provider value={api}>
      {children}
      <div className="appMessageLayer" aria-live="polite" aria-atomic="true">
        {messages.map((message) => (
          <div className={`appMessage appMessage-${message.type}`} key={message.id} role="status">
            <span className="appMessageIcon" aria-hidden="true">
              <AppMessageIcon type={message.type} />
            </span>
            <span className="appMessageText">
              <strong>{message.title}</strong>
              {message.description ? <small>{message.description}</small> : null}
            </span>
            <button
              className="appMessageClose"
              type="button"
              aria-label="关闭提示"
              onClick={() => remove(message.id)}
            >
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        ))}
      </div>
    </AppMessageContext.Provider>
  );
}

export function useAppMessage() {
  return useContext(AppMessageContext) ?? noopMessageApi;
}

function AppMessageIcon({ type }: { type: AppMessageType }) {
  if (type === "success") return <CheckCircle2 size={18} />;
  if (type === "error") return <AlertCircle size={18} />;
  if (type === "warning") return <TriangleAlert size={18} />;
  return <Info size={18} />;
}
