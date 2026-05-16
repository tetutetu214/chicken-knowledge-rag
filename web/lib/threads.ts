// Conversation の表示用整形・フィルタロジック。
// Amplify Data の生レコードを UI 用 ThreadRow に変換し、active / archived へ振り分ける。
// archived は optional フィールドのため undefined のレコードは active 扱いに丸める
// (DynamoDB スキーマレス特性で archived フィールドが無い古いレコードを救済)。

export interface ThreadRow {
    id: string;
    title: string;
    summary: string;
    summarizedCount: number;
    archived: boolean;
    expiresAt: number | null;
    updatedAt: string;
}

// Amplify Data から取り出した Conversation オブジェクトを ThreadRow に変換する。
// archived は厳密に true のときのみ archived 扱い、null/undefined/false はすべて active。
export const toThreadRow = (d: {
    id: string;
    title: string;
    summary?: string | null;
    summarizedCount?: number | null;
    archived?: boolean | null;
    expiresAt?: number | null;
    updatedAt: string;
}): ThreadRow => ({
    id: d.id,
    title: d.title,
    summary: d.summary ?? '',
    summarizedCount: d.summarizedCount ?? 0,
    archived: d.archived === true,
    expiresAt: d.expiresAt ?? null,
    updatedAt: d.updatedAt,
});

// 更新日時の降順でソートする (新しい順に並べる)。
export const sortByUpdatedAtDesc = (rows: ThreadRow[]): ThreadRow[] =>
    [...rows].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const filterActive = (rows: ThreadRow[]): ThreadRow[] =>
    rows.filter((r) => !r.archived);

export const filterArchived = (rows: ThreadRow[]): ThreadRow[] =>
    rows.filter((r) => r.archived);

// 旧仕様 (作成時 expiresAt = now + 90日) で作られたアクティブ会話を検出する。
// アクティブで expiresAt が設定されているレコードは「TTL対象外に戻すべき」と判定。
export const findOrphanActiveThreads = (rows: ThreadRow[]): ThreadRow[] =>
    rows.filter((r) => !r.archived && r.expiresAt != null);
