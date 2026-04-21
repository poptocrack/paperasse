export type ExtractorInput = {
  from: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachments: { filename: string; mimeType: string; data: Buffer }[];
};

export type ExtractorOutput = {
  vendor: string;
  amountCents: number;
  currency: string;
  invoiceDate: string;
  pdfData: Buffer;
};

export type SenderExtractor = {
  vendorKey: string;
  fromPatterns: RegExp[];
  extract: (input: ExtractorInput) => ExtractorOutput | null;
};
