import { useRef, useState } from "react";
import { ApiError, api, type Base } from "./api";

const MEDIA = /\.(jpe?g|png|webp|avif|tiff?|gif|mp4|mov|m4v)$/i;
const HEIC = /\.(heic|heif)$/i;

interface Props {
    bases: Base[];
    onImported: (id: string) => void;
}

type Stage =
    | { kind: "pick" }
    | { kind: "uploading"; done: number }
    | { kind: "importing" }
    | { kind: "error"; message: string; exists: boolean; log: string[] };

/** Files dropped or picked, flattened from any folders. */
const filesFrom = async (items: DataTransferItemList): Promise<File[]> => {
    const entries = [...items].flatMap((i) => {
        const e = i.webkitGetAsEntry?.();
        return e ? [e] : [];
    });
    const out: File[] = [];
    const walk = async (e: FileSystemEntry): Promise<void> => {
        if (e.isFile) {
            out.push(await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)));
        } else if (e.isDirectory) {
            const reader = (e as FileSystemDirectoryEntry).createReader();
            // readEntries returns at most 100 at a time.
            for (;;) {
                const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail));
                if (!batch.length) break;
                for (const child of batch) await walk(child);
            }
        }
    };
    for (const e of entries) await walk(e);
    return out;
};

/** A folder's name, as the default title: "Iceland" from ".../Iceland/IMG_1.jpg". */
const folderOf = (files: File[]) => files.find((f) => f.webkitRelativePath)?.webkitRelativePath.split("/")[0] ?? "";

export const ImportView = ({ bases, onImported }: Props) => {
    const [files, setFiles] = useState<File[]>([]);
    const [title, setTitle] = useState("");
    const [from, setFrom] = useState("");
    const [km, setKm] = useState(15);
    const [stage, setStage] = useState<Stage>({ kind: "pick" });
    const [over, setOver] = useState(false);
    const batch = useRef(crypto.randomUUID());
    const uploaded = useRef(false);

    const media = files.filter((f) => MEDIA.test(f.name));
    const heic = files.filter((f) => HEIC.test(f.name));

    const choose = (list: File[], folder = folderOf(list)) => {
        setFiles(list.filter((f) => !f.name.startsWith(".")));
        if (folder && !title) setTitle(folder);
        // A new set of photos needs a new upload.
        batch.current = crypto.randomUUID();
        uploaded.current = false;
        setStage({ kind: "pick" });
    };

    const run = async (force: boolean) => {
        try {
            if (!uploaded.current) {
                let done = 0;
                setStage({ kind: "uploading", done });
                const queue = [...media];
                const worker = async () => {
                    for (let f = queue.shift(); f; f = queue.shift()) {
                        await api.upload(batch.current, f);
                        setStage({ kind: "uploading", done: ++done });
                    }
                };
                await Promise.all(Array.from({ length: 4 }, worker));
                uploaded.current = true;
            }
            setStage({ kind: "importing" });
            const r = await api.import({ batch: batch.current, title: title.trim(), from: from || undefined, km, force });
            onImported(r.id);
        } catch (e) {
            const body = e instanceof ApiError ? e.body : {};
            setStage({ kind: "error", message: (e as Error).message, exists: !!body.exists, log: body.log ?? [] });
        }
    };

    const busy = stage.kind === "uploading" || stage.kind === "importing";
    return (
        <div className="import">
            <h2>Import photos</h2>
            <p className="muted">
                Pick a trip's photos and videos, exported from your phone or camera with their location. Each photo's time
                and GPS position group them into stops, named from OpenStreetMap. The originals are copied into{" "}
                <code>photos/</code> and web versions are made, then you can tidy up the draft.
            </p>

            <div
                className={`dropzone ${over ? "over" : ""}`}
                onDragOver={(e) => {
                    e.preventDefault();
                    setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={async (e) => {
                    e.preventDefault();
                    setOver(false);
                    const first = e.dataTransfer.items[0]?.webkitGetAsEntry?.();
                    choose(await filesFrom(e.dataTransfer.items), first?.isDirectory ? first.name : "");
                }}
            >
                <p>Drop a folder or photos here</p>
                <div className="dropzone-buttons">
                    <label className="button">
                        Choose folder
                        <input type="file" hidden {...{ webkitdirectory: "" }} onChange={(e) => choose([...(e.target.files ?? [])])} />
                    </label>
                    <label className="button">
                        Choose photos
                        <input type="file" hidden multiple accept="image/*,video/*" onChange={(e) => choose([...(e.target.files ?? [])])} />
                    </label>
                </div>
                {files.length > 0 && (
                    <p className="muted">
                        {media.length} photo(s) and video(s)
                        {files.length > media.length + heic.length && `, ${files.length - media.length - heic.length} other file(s) skipped`}
                    </p>
                )}
                {heic.length > 0 && (
                    <p className="studio-error">
                        {heic.length} HEIC photo(s) can't be read yet. Export them as JPEG (Photos app: File › Export, or
                        iPhone Settings › Camera › Formats › Most Compatible) and pick them again.
                    </p>
                )}
            </div>

            <div className="editor-fields">
                <label>
                    Title
                    <input value={title} placeholder="e.g. iceland" onChange={(e) => setTitle(e.target.value)} />
                </label>
                <label>
                    From
                    <select value={from} onChange={(e) => setFrom(e.target.value)}>
                        <option value="">(none)</option>
                        {bases.map((b) => (
                            <option key={b.key} value={b.key}>
                                {b.key} ({b.name})
                            </option>
                        ))}
                    </select>
                </label>
                <label className="narrow">
                    New stop after (km)
                    <input type="number" min={1} value={km} onChange={(e) => setKm(Number(e.target.value) || 15)} />
                </label>
            </div>

            <button className="primary" disabled={!media.length || heic.length > 0 || !title.trim() || busy} onClick={() => run(false)}>
                {stage.kind === "uploading"
                    ? `Copying ${stage.done}/${media.length}…`
                    : stage.kind === "importing"
                      ? "Grouping and naming stops…"
                      : `Import ${media.length || ""} photos`}
            </button>

            {stage.kind === "error" && (
                <div className="studio-error">
                    <p>{stage.message}</p>
                    {stage.exists && (
                        <p>
                            Change the title, or <button onClick={() => run(true)}>replace that trip</button>.
                        </p>
                    )}
                    {stage.log.length > 0 && <pre>{stage.log.join("\n")}</pre>}
                </div>
            )}
        </div>
    );
};
