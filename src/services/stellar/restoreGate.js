/**
 * Promise bridge from stellar services → React restore confirmation modal.
 * AppShell registers the handler; call sites use requestRestoreConfirm.
 */

let confirmHandler = null;
let inFlight = false;

/**
 * @param {null | ((info: object) => Promise<boolean>)} handler
 */
export function setRestoreConfirmHandler(handler) {
  confirmHandler = handler;
}

/**
 * Ask the user to approve a restore (and run performRestore when they confirm).
 * @param {{
 *   feePayer: string,
 *   minResourceFee: string|number,
 *   feeXlm?: string,
 *   performRestore: () => Promise<unknown>,
 * }} info
 * @returns {Promise<boolean>} true if restore ran successfully; false if cancelled
 */
export async function requestRestoreConfirm(info) {
  if (!confirmHandler) {
    throw new Error(
      "Contract state needs restore, but restore UI is not available. Unlock and try again.",
    );
  }
  if (inFlight) {
    throw new Error(
      "Another restore confirmation is already open. Finish or cancel it first.",
    );
  }
  inFlight = true;
  try {
    return await confirmHandler(info);
  } finally {
    inFlight = false;
  }
}
