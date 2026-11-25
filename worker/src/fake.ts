// The Worker with its Durable Objects in memory, for tests.
import { type Env, handle, PlanRoom, type RoomNamespace } from "./index";

/** The Worker with its Durable Objects in memory, as handle(request) -> response. */
export const fakeServer = (origins = "https://travel.example.com") => {
    const rooms = new Map<string, PlanRoom>();
    const PLANS: RoomNamespace = {
        idFromName: (name) => name,
        get: (id) => {
            const key = id as string;
            if (!rooms.has(key)) {
                const data = new Map<string, unknown>();
                rooms.set(key, new PlanRoom({ storage: { get: async <T>(k: string) => structuredClone(data.get(k)) as T, put: async (k, v) => void data.set(k, structuredClone(v)), delete: async (ks) => ks.forEach((k) => data.delete(k)) } }));
            }
            return rooms.get(key)!;
        },
    };
    const env: Env = { PLANS, ALLOWED_ORIGINS: origins };
    return (request: Request) => handle(request, env);
};
