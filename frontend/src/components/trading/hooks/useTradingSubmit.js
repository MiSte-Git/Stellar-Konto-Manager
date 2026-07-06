import { useState } from 'react';

/**
 * The confirm -> secret-key -> execute pipeline, as an explicit pendingAction
 * object instead of a bare modalAction string. beginAction(type, payload,
 * execute) builds { type, payload, execute } and opens SecretKeyModal;
 * SecretKeyModal.onConfirm then calls pendingAction.execute(signers)
 * directly instead of branching on a string. Extracted from AssetSearch.jsx
 * (step 6 of the file-split).
 *
 * type/payload are kept on the object (not folded away once execute is
 * known) because the container still needs type for modalOperationType/
 * requiredThreshold, and payload carries the pending create/cancel offer
 * details for the offer confirm modal.
 *
 * showSecretModal is owned here too - its lifecycle is 1:1 with
 * pendingAction (opened by beginAction, closed alongside it on cancel/
 * ambiguous-result), so keeping them apart would just mean every call site
 * toggles both in lockstep.
 *
 * This hook only replaces the dispatch mechanism. The actual submit
 * handlers (handleCreateTrustline, handleExecuteSwap, ...) and their
 * multisig/threshold logic are unchanged and still live in AssetSearch.jsx -
 * beginAction receives them as the execute argument built at each call site.
 */
export default function useTradingSubmit() {
  const [pendingAction, setPendingAction] = useState(null);
  const [showSecretModal, setShowSecretModal] = useState(false);

  const beginAction = (type, payload, execute) => {
    setPendingAction({ type, payload, execute });
    setShowSecretModal(true);
  };

  return {
    pendingAction,
    setPendingAction,
    showSecretModal,
    setShowSecretModal,
    beginAction,
  };
}
