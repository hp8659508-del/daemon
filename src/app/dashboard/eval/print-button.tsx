"use client";
import { Printer } from "lucide-react";
export default function PrintButton() {
  return <button className="key-primary" onClick={() => window.print()}><Printer size={15} /> Print / Save PDF</button>;
}
