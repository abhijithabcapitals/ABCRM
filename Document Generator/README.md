# Document Generator

The CRM's Document Generator tab is implemented in `index.jsx`. The Main Module
loads it on demand through the `@document-generator` alias configured in
`Main Module/vite.config.js`.

The module uses the host CRM's shared Supabase client and icons through the
`@app` alias. Its quotation templates, generated files, and CRM task behavior
remain connected to the existing Supabase schema.
