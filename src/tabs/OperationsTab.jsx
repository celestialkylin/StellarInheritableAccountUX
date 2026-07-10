import SendAssetForm from "../components/SendAssetForm.jsx";
import ContractMethodForm from "../components/ContractMethodForm.jsx";
import { invalidateCache } from "../services/cache.js";

export default function OperationsTab({ publicKey }) {
  return (
    <div>
      <SendAssetForm
        publicKey={publicKey}
        onSent={() => invalidateCache("info")}
      />
      <ContractMethodForm publicKey={publicKey} />
    </div>
  );
}