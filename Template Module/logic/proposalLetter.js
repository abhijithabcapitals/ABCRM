// Which action a proposal's engagement letter row offers. Pure, so it is tested.
// A letter is numbered first and filed after, so a row can exist without its file.
export const letterAction = (letter) => (!letter ? "create" : letter.storage_path ? "done" : "retry");
// A letter belongs to a proposal when its parent is a proposal row in the same list.
export const isProposalLetter = (doc, rows, template) => doc.doc_type === "letter" && (rows || []).some((r) => r.id === doc.parent_id && r.library_template === template);
