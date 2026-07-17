import { hasMigrationData } from "../crypto/notesMigration.js";
import { bytesToBuffer } from "../crypto/codec.js";
import { getCandidate, listCandidates } from "./candidates.js";
import { getInactiveTime } from "./inheritable.js";

/**
 * Shared candidates list for Info + Candidates tabs.
 * @returns {Promise<{ items: Array<{
 *   address: string,
 *   waitingTime: unknown,
 *   remaining: number,
 *   hasPreKey: boolean,
 * }>, inactiveTime: unknown }>}
 */
export async function fetchCandidatesData() {
  const [addrs, inactiveTime] = await Promise.all([
    listCandidates(),
    getInactiveTime(),
  ]);
  const items = await Promise.all(
    addrs.map(async (addr) => {
      const info = await getCandidate(addr);
      const remaining = Math.max(0, Number(info.waiting_time) - Number(inactiveTime));
      const hasPreKey = hasMigrationData(bytesToBuffer(info.migration_data));
      return {
        address: addr,
        waitingTime: info.waiting_time,
        remaining,
        hasPreKey,
      };
    }),
  );
  return { items, inactiveTime };
}
