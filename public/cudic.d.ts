/* file: public/cudic.d.ts
 * what: TypeScript declarations for Cudic's in-game runtime globals —
 *   CudicSave (account-bound saves) and CudicMulti (multiplayer rooms).
 * invariants: every signature here mirrors public/cudic-save.js and
 *   public/cudic-multi.js; change them together, or an editor will suggest a
 *   call that dies at runtime. Nothing here is loaded by a page — it is types.
 * see: public/docs.html#npm, AGENTS.md 8 */

/** Options for the one-time import of a pre-CudicSave localStorage payload. */
export interface CudicSaveOptions {
    /** Old localStorage key to read once, if no Cudic save exists yet. */
    legacyKey?: string;
    /** Turn the legacy payload into the object shape this game saves now. */
    legacyMap?: (raw: unknown) => Record<string, unknown>;
}

export interface CudicPeer {
    id: string;
    name: string;
}

export interface CudicMessage {
    /** Peer id of the sender. */
    from: string;
    /** Whatever that peer passed to send(). */
    data: unknown;
}

/** A room handle from CudicMulti.join(). */
export interface CudicNet {
    /** This player's peer id, known once 'open' fires. */
    id: string | null;
    /** Everyone in the room, including you. */
    peers: CudicPeer[];
    on(event: 'open' | 'close', fn: () => void): CudicNet;
    on(event: 'error', fn: (text: string) => void): CudicNet;
    on(event: 'peers', fn: (peers: CudicPeer[]) => void): CudicNet;
    on(event: 'msg', fn: (message: CudicMessage) => void): CudicNet;
    on(event: string, fn: (arg: never) => void): CudicNet;
    /** Any JSON value. Sends before 'open' are queued, not dropped. */
    send(data: unknown): CudicNet;
    /** Leave the room; no further events fire. */
    leave(): CudicNet;
}

declare global {
    /**
     * Account-bound saves. Guests persist nothing; the player page mediates the
     * cloud write, so game code never sees the login token.
     */
    const CudicSave: {
        /** Current save, or null for a guest / first visit. */
        load<T extends Record<string, unknown> = Record<string, unknown>>(
            options?: CudicSaveOptions
        ): Promise<T | null>;
        /** Debounced cloud write when signed in, local mirror otherwise. */
        save(data: Record<string, unknown>): void;
        /** Reset the save everywhere this account plays. */
        clear(): void;
    };

    /** Multiplayer rooms, relayed by the game page. */
    const CudicMulti: {
        /** Join a room; the code is optional and defaults to 'main'. */
        join(room?: string): CudicNet;
        readonly version: number;
    };
}
