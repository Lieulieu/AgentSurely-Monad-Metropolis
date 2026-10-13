"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import clsx from "clsx";

type Toast = { id: number; kind: "info" | "ok" | "bad"; text: string };
const Ctx = createContext<{ push: (t: Omit<Toast, "id">) => void }>({ push: () => {} });
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs.slice(-3), { ...t, id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2">
        {items.map((t) => {
          const Icon = t.kind === "ok" ? CheckCircle2 : t.kind === "bad" ? XCircle : Info;
          return (
            <div key={t.id} role="status" className="card pointer-events-auto flex items-start gap-3 px-4 py-3 text-sm">
              <Icon className={clsx("mt-0.5 h-4 w-4 shrink-0", t.kind === "ok" ? "text-ok" : t.kind === "bad" ? "text-bad" : "text-brand")} />
              <span className="text-ink-2">{t.text}</span>
            </div>
          );
        })}
      </div>
    </Ctx.Provider>
  );
}
