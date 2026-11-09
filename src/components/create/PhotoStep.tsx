"use client";

import { useEffect, useRef, useState } from "react";
import { api, ownerUrl } from "@/lib/client/api";
import { checkSelfie, type SelfieCheck } from "@/lib/client/selfieCheck";
import { Button, Card, cx, Notice, Spinner } from "@/components/ui";
import type { StepProps } from "./CreateFlow";

const TIPS = [
  "Face the camera at eye level",
  "Soft, even light (a window is perfect)",
  "Relaxed expression, mouth closed",
  "No sunglasses or hats covering your face",
];

export function PhotoStep({ avatar, token, onChange, goTo }: StepProps) {
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [check, setCheck] = useState<SelfieCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [consent, setConsent] = useState(avatar.consent);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function choose(blob: Blob) {
    setError(null);
    setCheck(null);
    if (!blob.type.startsWith("image/")) return setError("Please choose an image file.");
    const url = URL.createObjectURL(blob);
    setFile(blob);
    setPreview(url);
    setChecking(true);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      setCheck(await checkSelfie(img));
    } catch {
      setCheck({ errors: [], warnings: ["Couldn't analyze this photo on your device. You can still continue."] });
    } finally {
      setChecking(false);
    }
  }

  async function upload() {
    if (!file) return goTo("look");
    setUploading(true);
    setError(null);
    try {
      const { avatar: next } = await api.uploadSelfie(avatar.id, token, file);
      onChange(next);
      goTo("look");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
    }
  }

  const shown = preview ?? (avatar.selfieUrl ? ownerUrl(avatar.selfieUrl, token) : null);
  const blocked = !!check?.errors.length;
  const canContinue = (file ? consent && !blocked && !checking : !!avatar.selfieUrl) && !uploading;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px]">
      <section>
        <p className="text-sm font-medium text-accent-600">Step 1</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight sm:text-4xl">Start with a selfie</h1>
        <p className="mt-2 max-w-xl text-ink-600">
          We use it to capture your likeness. Your 3D character keeps your face, skin tone and hair (unless you change them).
        </p>

        <ul className="mt-6 grid gap-2 sm:grid-cols-2">
          {TIPS.map((t) => (
            <li key={t} className="flex items-center gap-2 rounded-2xl bg-card px-3 py-2.5 text-sm text-ink-700 shadow-soft">
              <span className="grid size-5 place-items-center rounded-full bg-accent-50 text-[11px] text-accent-600">✓</span>
              {t}
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button size="lg" onClick={() => inputRef.current?.click()}>
            Upload a photo
          </Button>
          <Button size="lg" variant="secondary" onClick={() => setCamera(true)}>
            Use camera
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])}
          />
        </div>

        {camera && (
          <CameraCapture
            onCancel={() => setCamera(false)}
            onCapture={(b) => {
              setCamera(false);
              choose(b);
            }}
          />
        )}

        {(file || avatar.selfieUrl) && (
          <div className="mt-8 space-y-3">
            {checking && (
              <p className="flex items-center gap-2 text-sm text-ink-500">
                <Spinner className="size-4" /> Checking your photo on this device…
              </p>
            )}
            {check?.errors.map((e) => (
              <Notice key={e} tone="error">
                {e}
              </Notice>
            ))}
            {check?.warnings.map((w) => (
              <Notice key={w} tone="warn">
                {w}
              </Notice>
            ))}
            {check && !check.errors.length && !check.warnings.length && (
              <Notice>Looks great. Clear face, good light.</Notice>
            )}
            {file && (
              <label className="flex items-start gap-3 rounded-2xl border border-ink-100 bg-card p-3 text-sm text-ink-700">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-accent-500"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                <span>
                  This is me, or I have this person&apos;s permission to create an AI avatar of them. I understand visitors
                  will talk to an AI that looks like this person.
                </span>
              </label>
            )}
            {error && <Notice tone="error">{error}</Notice>}
            <Button size="lg" disabled={!canContinue} loading={uploading} onClick={upload}>
              {file ? "Use this photo" : "Continue"}
            </Button>
          </div>
        )}
      </section>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden p-2">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              const f = e.dataTransfer.files?.[0];
              if (f) choose(f);
            }}
            className={cx(
              "relative grid aspect-[3/4] place-items-center overflow-hidden rounded-[1.25rem] transition-colors",
              shown ? "bg-ink-900" : "checker bg-ink-50",
              dragging && "ring-4 ring-accent-200",
            )}
          >
            {shown ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={shown} alt="Your selfie" className="size-full object-contain" />
                {check?.box && (
                  <span
                    className="pointer-events-none absolute rounded-[40%] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
                    style={{
                      left: `${check.box.x * 100}%`,
                      top: `${check.box.y * 100}%`,
                      width: `${check.box.w * 100}%`,
                      height: `${check.box.h * 100}%`,
                    }}
                  />
                )}
              </>
            ) : (
              <div className="px-8 text-center text-sm text-ink-500">
                <div className="mx-auto mb-3 h-28 w-20 rounded-[45%] border-2 border-dashed border-ink-300" />
                Drop a photo here
              </div>
            )}
          </div>
        </Card>
        <p className="mt-3 px-2 text-xs text-ink-500">
          Your photo is only used to create your avatar. It is never shown on your public page.
        </p>
      </aside>
    </div>
  );
}

function CameraCapture({ onCapture, onCancel }: { onCapture: (b: Blob) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 1280 } } })
      .then((s) => {
        stream = s;
        if (video.current) {
          video.current.srcObject = s;
          video.current.play().catch(() => {});
        }
      })
      .catch(() => setError("We couldn't open your camera. Check permissions or upload a photo instead."));
    return () => stream?.getTracks().forEach((t) => t.stop());
  }, []);

  function capture() {
    const v = video.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && onCapture(b), "image/jpeg", 0.92);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-ink-900/70 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-md overflow-hidden p-3">
        {error ? (
          <Notice tone="error">{error}</Notice>
        ) : (
          <div className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-black">
            <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              <div className="h-[58%] w-[52%] rounded-[45%] border-2 border-white/70" />
            </div>
          </div>
        )}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          {!error && <Button onClick={capture}>Take photo</Button>}
        </div>
      </Card>
    </div>
  );
}
