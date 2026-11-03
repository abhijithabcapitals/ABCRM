import { createContext, useContext } from "react";

// { can(permission), profile, role, people, personName(id), personOptions, goTo(page, params) }
export const SetupContext = createContext(null);
export const useSetup = () => useContext(SetupContext);
