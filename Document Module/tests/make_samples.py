"""Writes fictional sample documents for the tests (text-layer PDFs + a text file). No real client data."""
from pathlib import Path

HERE = Path(__file__).parent / "samples"


def pdf(lines: list[str]) -> bytes:
    """A minimal one-page PDF with a real text layer."""
    esc = lambda s: s.replace("\\", "\\\\").replace("(", r"\(").replace(")", r"\)")
    stream = "BT /F1 11 Tf 50 800 Td 15 TL " + " ".join(f"({esc(l)}) '" for l in lines) + " ET"
    objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
            f"<< /Length {len(stream)} >>\nstream\n{stream}\nendstream",
            "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    out, offs = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f"{i} 0 obj\n{o}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + b"".join(f"{o:010d} 00000 n \n".encode() for o in offs)
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return out


def main() -> None:
    HERE.mkdir(exist_ok=True)
    (HERE / "Trade License - Falcon.pdf").write_bytes(pdf([
        "Government of Dubai", "Department of Economy and Tourism", "Commercial License",
        "License No 1234567", "Trade Name Falcon General Trading L.L.C", "Legal Form Limited Liability Company",
        "Registration No 2233445", "Issue Date 15/01/2026", "Expiry Date 14/01/2027", "First Issue Date 15/01/2019",
        "Activities 1. General Trading 2. Import and Export of Foodstuff 3. Logistics Services",
        "Premises Number 302", "Building Name Al Fajer Tower", "Business District Deira, Dubai",
        "Email accounts@falcontrading.example", "Contact Number +971 4 123 4567", "Manager Ahmed Khan"]))
    (HERE / "VAT Certificate.pdf").write_bytes(pdf([
        "Federal Tax Authority", "VAT Registration Certificate", "Tax Registration Number 100123456700003",
        "Legal Name of Entity (English) Falcon General Trading L.L.C",
        "Registered Address, and Contact Number Office 302, Al Fajer Tower, Deira, Dubai",
        "Effective Registration Date 01/03/2024", "Date of Issue 05/03/2024",
        "First VAT Return Period 01/03/2024 - 31/05/2024"]))
    (HERE / "CT Registration Certificate.pdf").write_bytes(pdf([
        "Federal Tax Authority", "Corporate Tax Registration Certificate", "Tax Registration Number 100123456700003",
        "Legal Name of Entity (English) Falcon General Trading L.L.C", "Effective Registration Date 01/01/2024",
        "First Corporate Tax Period 01/01/2024 - 31/12/2024"]))
    (HERE / "ENBD statement March 2026.pdf").write_bytes(pdf([
        "Emirates NBD", "Statement of Account", "Account Name Falcon General Trading LLC",
        "IBAN AE07 0331 2345 6789 0123 456", "Currency AED", "Statement Period 01/03/2026 - 31/03/2026",
        "Opening Balance 120,000.00", "Closing Balance 98,500.00"]))
    (HERE / "portal logins.txt").write_text("FTA portal\nusername: falcon\npassword: example-not-real\n", encoding="utf-8")


if __name__ == "__main__":
    main()
