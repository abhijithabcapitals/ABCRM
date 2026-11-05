// The fill form in a pop-up, used from Company Library.
import { Modal } from "@banking/components/shared";
import LibraryForm from "./LibraryForm";

export default function LibraryFill({ template, fileId, start, onClose, onDone, onFailed }) {
  return (
    <Modal wide title={`Fill: ${template.name}`} onClose={onClose}>
      <LibraryForm template={template} fileId={fileId} start={start} onClose={onClose} onDone={onDone} onFailed={onFailed} />
    </Modal>
  );
}
