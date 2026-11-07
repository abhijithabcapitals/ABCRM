// Wires the real server calls into the deps that proposalGenerate.js asks for. Shared by the form and the documents list.
import { renderProposal } from "../logic/proposalDocx.js";
import { checkProposal } from "../logic/proposalModel.js";
import { signHubDocument } from "./signingApi";
import { attachProposal, createProposal, createProposalMail, loadProposalImages, markProposalSaved, saveProposalFolder, sendProposal, storedBlob, uploadProposalFile } from "./proposalApi";

async function loadTemplate() {
  const res = await fetch(new URL("../templates/AB_Capital_Proposal_Template.docx", import.meta.url));
  if (!res.ok) throw new Error("The proposal template could not be loaded.");
  return res.arrayBuffer();
}

// signature: only when signing (the shared step's rebuild); the stored files are made without one.
async function render(template, context, images, signature) {
  const [{ default: PizZip }, { default: Docxtemplater }] = await Promise.all([import("pizzip"), import("docxtemplater")]);
  return renderProposal(template, context, images, { PizZip, Docxtemplater }, signature || null);
}

async function toPdf(wordBlob) {
  const { docxToPdf } = await import("../ardentax/logic/docxToPdf.js");
  // One thin border inset from the page edge, as in the old proposals (Word keeps its own page border).
  return docxToPdf(wordBlob, { pageStyle: "top:24px;left:24px;right:24px;bottom:24px;border:1px solid #000;box-sizing:border-box" });
}

export const proposalDeps = {
  checkFirst: checkProposal, create: createProposal, loadTemplate, loadImages: loadProposalImages, render, toPdf,
  upload: uploadProposalFile, attach: attachProposal, saveLocal: saveProposalFolder, markSaved: markProposalSaved, createMail: createProposalMail,
  send: (id) => sendProposal(id, false, false),
  // The shared signing step: the image comes from Settings > Signing (AB Capital), the files go under Business Setup/<id>/signed/.
  sign: (args) => signHubDocument(args, { toPdf }),
};

// For "Save now": the stored files are copied into the office folder again.
export const oneDriveDeps = { loadStored: storedBlob, saveLocal: saveProposalFolder, markSaved: markProposalSaved };

// The PDF download name lives with the pure proposal rules, where it is tested.
export { pdfName } from "../logic/proposalModel.js";
