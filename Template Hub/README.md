# Template Hub

The CRM's Template Hub tab is implemented in `index.jsx`. The Main Module
loads it on demand through the `@template-hub` alias configured in
`Main Module/vite.config.js`.

The module uses the host CRM's shared Supabase client and icons through the
`@app` alias. Its quotation templates, generated files, and CRM task behavior
remain connected to the existing Supabase schema.
