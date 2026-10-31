// Logo badge before a bank's name: the logo set on the bank, else its website's icon, else its initials.
import { useState } from "react";
import { bankInitials } from "../logic/bankInitials";

export function bankLogoUrl(bank) {
  if (bank.logo_url) return bank.logo_url;
  try { return `https://www.google.com/s2/favicons?sz=64&domain=${new URL(bank.website).hostname}`; } catch { return null; }
}

export default function BankLogo({ bank, size = 26 }) {
  const url = bankLogoUrl(bank);
  const [failed, setFailed] = useState(false);
  return (
    <span className="bk-logo" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {url && !failed ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : bankInitials(bank.bank_name)}
    </span>
  );
}

export const BankName = ({ bank, size }) => <span className="bk-bank-name"><BankLogo bank={bank} size={size} />{bank.bank_name}</span>;
