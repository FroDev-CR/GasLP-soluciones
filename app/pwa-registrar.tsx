"use client";

import Image from "next/image";
import { useEffect } from "react";
import { useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export function PwaRegistrar() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const clearInstallPrompt = () => setInstallPrompt(null);

    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", clearInstallPrompt);

    if ("serviceWorker" in navigator) {
      const register = () => {
        void navigator.serviceWorker.register("/sw.js", { scope: "/" });
      };

      if (document.readyState === "complete") {
        register();
      } else {
        window.addEventListener("load", register, { once: true });
      }
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", clearInstallPrompt);
    };
  }, []);

  const install = async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstallPrompt(null);
    }
  };

  if (!installPrompt) {
    return null;
  }

  return (
    <aside className="pwa-install" aria-label="Instalar GAS LP SOLUCIONES">
      <Image src="/icons/icon-192.png" alt="" width={44} height={44} />
      <div>
        <strong>Instalar GAS LP</strong>
        <span>Creá un acceso directo en tu teléfono.</span>
      </div>
      <button type="button" onClick={install}>Instalar</button>
      <button
        className="pwa-install-close"
        type="button"
        onClick={() => setInstallPrompt(null)}
        aria-label="Cerrar"
      >
        ×
      </button>
    </aside>
  );
}
