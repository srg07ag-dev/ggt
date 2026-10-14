import PDFDocument from "pdfkit";
import { formatMoney } from "@/lib/money";
import { formatRate } from "./calc";
import type { getDocument } from "./documents";

type Full = NonNullable<Awaited<ReturnType<typeof getDocument>>>;

const TITLES = { quote: "DEVIS", invoice: "FACTURE", credit_note: "AVOIR" } as const;

// Les polices PDF standard ne contiennent pas les espaces fines des formats régionaux.
const clean = (s: string) => s.replace(/[   ]/g, " ");

interface Party {
  name: string;
  address?: string | null;
  taxId?: string | null;
  email?: string | null;
  phone?: string | null;
  organization?: string | null;
}

/** Génère le PDF d'un document. Un document émis utilise les identités figées à l'émission. */
export async function renderDocumentPdf(d: Full): Promise<Buffer> {
  const { doc, lines, company, contact } = d;
  const snap = doc.snapshot as { seller: Party; customer: Party } | null;
  const seller: Party = snap?.seller ?? { name: company.name, address: company.address, taxId: company.taxId, email: company.email, phone: company.phone };
  const customer: Party = snap?.customer ?? { name: contact.name, address: contact.address, email: contact.email, phone: contact.phone, organization: contact.organization };
  const money = (n: number) => clean(formatMoney(n, doc.currency, "fr-FR"));

  const pdf = new PDFDocument({ size: "A4", margin: 48, info: { Title: `${TITLES[doc.type]} ${doc.number ?? "(brouillon)"}` } });
  const chunks: Buffer[] = [];
  pdf.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => pdf.on("end", () => resolve(Buffer.concat(chunks))));

  const ink = "#1b1a2e";
  const muted = "#6a6884";
  const accent = "#6558d3";
  const left = 48;
  const right = pdf.page.width - 48;

  // En-tête : émetteur à gauche, titre et numéro à droite
  pdf.fillColor(ink).font("Helvetica-Bold").fontSize(15).text(clean(seller.name), left, 48, { width: 260 });
  pdf.font("Helvetica").fontSize(9).fillColor(muted);
  for (const l of [seller.address, seller.taxId && `Identifiant : ${seller.taxId}`, seller.email, seller.phone]) if (l) pdf.text(clean(l), { width: 260 });

  pdf.fillColor(accent).font("Helvetica-Bold").fontSize(20).text(TITLES[doc.type], 330, 48, { width: right - 330, align: "right" });
  pdf.fillColor(ink).font("Helvetica").fontSize(10).text(doc.number ? `N° ${doc.number}` : "Brouillon", 330, 74, { width: right - 330, align: "right" });
  pdf.fillColor(muted).fontSize(9).text(`Date : ${doc.issueDate}`, 330, 90, { width: right - 330, align: "right" });
  if (doc.dueDate && doc.type !== "credit_note") pdf.text(`Échéance : ${doc.dueDate}`, { width: right - 330, align: "right" });
  if (d.related?.number) pdf.text(`Réf. : ${d.related.number}`, { width: right - 330, align: "right" });

  // Client
  let y = 170;
  pdf.fillColor(muted).fontSize(8).text("CLIENT", left, y);
  pdf.fillColor(ink).font("Helvetica-Bold").fontSize(11).text(clean(customer.name), left, y + 12);
  pdf.font("Helvetica").fontSize(9).fillColor(muted);
  for (const l of [customer.organization, customer.address, customer.email, customer.phone]) if (l) pdf.text(clean(l), { width: 300 });

  // Lignes
  y = Math.max(pdf.y + 24, 250);
  const cols = { desc: left, qty: 300, pu: 350, tax: 425, total: 470 };
  const header = () => {
    pdf.rect(left, y, right - left, 20).fill("#f4f3fb");
    pdf.fillColor(muted).font("Helvetica-Bold").fontSize(8);
    pdf.text("Description", cols.desc + 6, y + 6);
    pdf.text("Qté", cols.qty, y + 6, { width: 40, align: "right" });
    pdf.text("Prix unit. HT", cols.pu, y + 6, { width: 65, align: "right" });
    pdf.text("Taxe", cols.tax, y + 6, { width: 40, align: "right" });
    pdf.text("Total HT", cols.total, y + 6, { width: right - cols.total - 6, align: "right" });
    y += 26;
  };
  header();
  pdf.font("Helvetica").fontSize(9).fillColor(ink);
  for (const l of lines) {
    const h = pdf.heightOfString(clean(l.description), { width: 240 });
    if (y + h + 10 > pdf.page.height - 180) {
      pdf.addPage();
      y = 48;
      header();
      pdf.font("Helvetica").fontSize(9).fillColor(ink);
    }
    pdf.text(clean(l.description), cols.desc + 6, y, { width: 240 });
    pdf.text((l.quantityMilli / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 3 }), cols.qty, y, { width: 40, align: "right" });
    pdf.text(money(l.unitPriceMinor), cols.pu, y, { width: 65, align: "right" });
    pdf.text(l.taxRateBp ? formatRate(l.taxRateBp) : "—", cols.tax, y, { width: 40, align: "right" });
    pdf.text(money(l.netMinor), cols.total, y, { width: right - cols.total - 6, align: "right" });
    y += Math.max(h, 12) + 8;
    pdf.moveTo(left, y - 4).lineTo(right, y - 4).strokeColor("#e6e4f1").lineWidth(0.5).stroke();
  }

  // Totaux
  y += 8;
  const row = (label: string, value: string, bold = false) => {
    pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9).fillColor(bold ? ink : muted);
    pdf.text(label, 330, y, { width: 120 });
    pdf.fillColor(ink).text(value, 440, y, { width: right - 440, align: "right" });
    y += bold ? 20 : 15;
  };
  row("Total HT", money(doc.subtotalMinor));
  row("Taxes", money(doc.taxMinor));
  row(doc.type === "credit_note" ? "Total à créditer" : "Total TTC", money(doc.totalMinor), true);
  if (doc.type === "invoice" && doc.status === "issued") {
    row("Déjà réglé", money(d.settlement.paidMinor));
    if (d.settlement.creditedMinor) row("Avoirs", money(d.settlement.creditedMinor));
    row("Reste à payer", money(d.settlement.outstandingMinor), true);
  }

  if (doc.notes) {
    y += 10;
    pdf.font("Helvetica").fontSize(9).fillColor(muted).text(clean(doc.notes), left, y, { width: 300 });
  }

  if (doc.status === "draft") {
    pdf.save().rotate(-30, { origin: [300, 420] }).fillColor("#6a6884").fillOpacity(0.12).font("Helvetica-Bold").fontSize(90).text("BROUILLON", 90, 380).restore();
  }
  pdf.end();
  return done;
}
