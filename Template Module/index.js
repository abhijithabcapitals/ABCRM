// Template module — public entry point.
// Mount <QuotationsPage profile={profile} /> as a view in the host CRM, or use
// the pieces below individually.
import "./styles/template-module.css";

export { default as QuotationsPage } from "./components/QuotationsPage";
export { default as GenerateTab } from "./components/GenerateTab";
export { default as TemplatesTab } from "./components/TemplatesTab";
export { default as TemplateEditor } from "./components/TemplateEditor";
export { default as CompanyTemplatesPage } from "./components/CompanyTemplatesPage";
export * from "./logic/companyTemplates";

export * from "./logic/helpers";
export { buildContext } from "./logic/buildContext";
export { renderDocx } from "./logic/renderDocx";
export { diffTemplateFields } from "./logic/diffTemplateFields";

export * from "./services/templatesApi";
export { createCrmTask } from "./services/crmTask";
