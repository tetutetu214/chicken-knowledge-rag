// DynamoDB TTL: アーカイブ操作時刻からの「ゴミ箱」期間。
// アクティブ会話は expiresAt = null で TTL 対象外、アーカイブ時に now + 90日(秒) を上書きする
// (2026-05-10 仕様変更、knowledge.md 参照)。
// Unix epoch は「秒」必須なので Math.floor で潰す (ミリ秒のまま入れると永遠に消えない)。

export const ARCHIVE_TTL_DAYS = 90;

export const archiveExpiresAt = (
    nowMs: number = Date.now(),
): number => Math.floor(nowMs / 1000) + ARCHIVE_TTL_DAYS * 86400;

// アーカイブ済み行に「あと N 日で削除」を出すための残日数計算。
// 期限を過ぎている (秒数 <= 0) 場合は 0 を返し、未設定 (null) は null を返す。
export const remainingDaysUntilDelete = (
    expiresAt: number | null,
    nowMs: number = Date.now(),
): number | null => {
    if (expiresAt == null) return null;
    const seconds = expiresAt - Math.floor(nowMs / 1000);
    return seconds <= 0 ? 0 : Math.ceil(seconds / 86400);
};
