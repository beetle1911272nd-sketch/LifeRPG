import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "../app.generated.jsx";

/* ============================================================================
起動動画（LAUNCH VIDEO）
アプリを開くたびに一度だけ全画面で再生し、終了・スキップ後に本編を表示する。
`public/launch-video.mp4` を配置すると自動的に流れる（存在しないソースを
<source>に混在させるとブラウザによっては次候補へフォールバックせず
エラー扱いになるため、実在するファイルのみを列挙すること）。
動画が無い・読み込みに失敗した場合は何もせず本編へ進む。
============================================================================ */
const LAUNCH_VIDEO_SOURCES = [
  { src: "/launch-video.mp4", type: "video/mp4" },
];

function LaunchIntro({ children }) {
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
  const isStandalonePwa = typeof window !== "undefined" && (
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true
  );
  const [phase, setPhase] = useState(prefersReducedMotion ? "done" : "playing");
  const [videoUnavailable, setVideoUnavailable] = useState(false);
  // ブラウザの自動再生ポリシー上、音声ありの自動再生が拒否された場合は
  // ミュートで再生を続けつつ、タップで音を有効化できるようにする。
  const [needsSoundTap, setNeedsSoundTap] = useState(isStandalonePwa);
  const [softenTransition, setSoftenTransition] = useState(false);
  const [fadeOutVideo, setFadeOutVideo] = useState(false);
  const videoRef = useRef(null);
  const loadTimeoutRef = useRef(null);
  const stallTimeoutRef = useRef(null);
  const playbackTimeoutRef = useRef(null);
  const finish = () => setPhase((current) => (current === "done" ? current : "leaving"));

  useEffect(() => {
    if (phase !== "leaving") return undefined;
    const timer = window.setTimeout(() => setPhase("done"), 420);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    if (phase !== "playing") return undefined;
    const video = videoRef.current;
    if (!video) return undefined;
    let hasPlayed = false;
    const clearLoadTimeout = () => {
      window.clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = null;
    };
    const handlePlaying = () => {
      const firstPlayback = !hasPlayed;
      hasPlayed = true;
      clearLoadTimeout();
      window.clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = null;
      if (firstPlayback) {
        const remainingMs = Number.isFinite(video.duration)
          ? Math.max(0, video.duration - video.currentTime) * 1000
          : 18000;
        playbackTimeoutRef.current = window.setTimeout(finish, remainingMs + 2500);
      }
    };
    const handleWaiting = () => {
      if (!hasPlayed) return;
      window.clearTimeout(stallTimeoutRef.current);
      stallTimeoutRef.current = window.setTimeout(finish, 2500);
    };
    const handlePause = () => {
      if (hasPlayed && !video.ended) finish();
    };
    loadTimeoutRef.current = window.setTimeout(finish, 12000);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("waiting", handleWaiting);
    video.addEventListener("pause", handlePause);
    video.muted = isStandalonePwa;
    video.play().catch(() => {
      // 音声ありの自動再生がブロックされた場合は、ミュートで再生を継続し
      // タップで音を有効化できるボタンを表示する。
      video.muted = true;
      setNeedsSoundTap(true);
      video.play().catch(finish);
    });
    return () => {
      clearLoadTimeout();
      window.clearTimeout(stallTimeoutRef.current);
      window.clearTimeout(playbackTimeoutRef.current);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("waiting", handleWaiting);
      video.removeEventListener("pause", handlePause);
    };
  }, [phase]);

  const enableSound = (event) => {
    event.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().catch(() => {});
    setNeedsSoundTap(false);
  };
  const handleVideoTimeUpdate = (event) => {
    const video = event.currentTarget;
    const currentTime = video.currentTime;
    setSoftenTransition(currentTime >= 2.45 && currentTime <= 3.15);
    setFadeOutVideo(Number.isFinite(video.duration) && video.duration - currentTime <= 1.25);
    if (Number.isFinite(video.duration) && currentTime >= video.duration - 0.12) finish();
  };

  if (phase === "done") return children;

  return (
    <>
      <div
        className={`launch-intro${phase === "leaving" ? " launch-intro-leaving" : ""}`}
        onClick={finish}
      >
        {!videoUnavailable && (
          <video
            ref={videoRef}
            className="launch-intro-video"
            data-transition-softened={softenTransition}
            data-ending-fade={fadeOutVideo}
            muted={isStandalonePwa}
            playsInline
            autoPlay
            preload="auto"
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={() => {
              setFadeOutVideo(true);
              window.setTimeout(finish, 1050);
            }}
            onError={() => { setVideoUnavailable(true); finish(); }}
          >
            {LAUNCH_VIDEO_SOURCES.map((source) => <source key={source.src} src={source.src} type={source.type} />)}
          </video>
        )}
        {needsSoundTap && (
          <button type="button" className="launch-intro-sound" onClick={enableSound}>🔈 音を出す</button>
        )}
        <button type="button" className="launch-intro-skip" onClick={(event) => { event.stopPropagation(); finish(); }}>今すぐアプリを開く →</button>
      </div>
      <style>{`
        .launch-intro { position: fixed; inset: 0; z-index: 9999; background: #000; display: grid; place-items: center; cursor: pointer; opacity: 1; transition: opacity 380ms ease; }
        .launch-intro-leaving { opacity: 0; }
        .launch-intro-video { width: 100%; height: 100%; object-fit: contain; transition: filter 180ms ease, transform 180ms ease, opacity 1050ms ease-in; }
        .launch-intro-video[data-transition-softened="true"] { filter: blur(1.5px) brightness(1.035); transform: scale(1.012); }
        .launch-intro-video[data-ending-fade="true"] { opacity: 0; }
        .launch-intro-sound { position: absolute; top: max(18px, env(safe-area-inset-top)); right: 18px; border: 1px solid #999; background: #000c; color: #eee; padding: 8px 14px; font: 11px/1 Georgia, "Times New Roman", serif; letter-spacing: .1em; border-radius: 999px; }
        .launch-intro-skip { position: absolute; right: 16px; bottom: max(18px, env(safe-area-inset-bottom)); left: 16px; width: calc(100% - 32px); border: 1px solid #9998; border-radius: 999px; padding: 12px 16px; background: #000b; color: #eee; text-align: center; font: 11px/1.2 Georgia, "Times New Roman", serif; letter-spacing: .1em; cursor: pointer; }
        @media (prefers-reduced-motion: reduce) { .launch-intro { display: none; } .launch-intro-video { transition: none; } .launch-intro-video[data-transition-softened="true"] { filter: none; transform: none; } .launch-intro-video[data-ending-fade="true"] { opacity: 1; } }
      `}</style>
      {children}
    </>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("LIFE RPGの画面描画に失敗しました。", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main style={{ minHeight: "100vh", padding: "32px 20px", background: "#080808", color: "#f1f1ed", fontFamily: "system-ui, sans-serif" }}>
        <p style={{ color: "#aaa", letterSpacing: ".12em", fontSize: "11px" }}>LIFE RPG ERROR</p>
        <h1 style={{ fontWeight: 400 }}>画面を表示できませんでした</h1>
        <p style={{ color: "#aaa", lineHeight: 1.8 }}>保存データは削除されていません。ページを再読み込みしてください。</p>
        <pre style={{ whiteSpace: "pre-wrap", color: "#d8a8a8", fontSize: "12px" }}>{this.state.error?.message || "Unknown error"}</pre>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: "12px 16px" }}>再読み込み</button>
      </main>
    );
  }
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }).then((registration) => {
      const announceUpdate = (worker) => {
        window.dispatchEvent(new CustomEvent("life-rpg-update-ready", {
          detail: { registration, worker },
        }));
      };

      if (registration.waiting) announceUpdate(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            announceUpdate(worker);
          }
        });
      });
      registration.update().catch((error) => {
        console.warn("LIFE RPGの更新確認に失敗しました。", error);
      });
    }).catch((error) => {
      console.error("Service Workerの登録に失敗しました。", error);
    });
  });
}

let isRefreshing = false;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isRefreshing) return;
    isRefreshing = true;
    window.location.reload();
  });
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <LaunchIntro>
        <App />
      </LaunchIntro>
    </AppErrorBoundary>
  </React.StrictMode>,
);
