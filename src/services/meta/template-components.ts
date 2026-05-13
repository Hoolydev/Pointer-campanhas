import { renderTemplate } from "@/lib/templates";

type TemplateContact = {
  name: string | null;
  phone: string;
};

type TemplateMediaHeader = {
  type: string | null;
  url?: string | null;
  id?: string | null;
};

export function buildTemplateComponents({
  params,
  contact,
  header
}: {
  params: unknown;
  contact: TemplateContact;
  header?: TemplateMediaHeader | null;
}) {
  return [
    ...buildHeaderTemplateComponent(header),
    ...buildBodyTemplateComponents(params, contact)
  ];
}

export function buildBodyTemplateComponents(params: unknown, contact: TemplateContact) {
  const values = Array.isArray(params)
    ? params
        .map((param) => (typeof param === "string" ? param.trim() : ""))
        .filter(Boolean)
        .map((param) =>
          renderTemplate(param, {
            nome: contact.name,
            name: contact.name,
            telefone: contact.phone,
            phone: contact.phone
          })
        )
    : [];

  if (values.length === 0) {
    return [];
  }

  return [
    {
      type: "body",
      parameters: values.map((text) => ({
        type: "text",
        text
      }))
    }
  ];
}

function buildHeaderTemplateComponent(header?: TemplateMediaHeader | null) {
  if (!header?.type || (!header.url && !header.id)) {
    return [];
  }

  if (header.type !== "image" && header.type !== "video" && header.type !== "document") {
    return [];
  }

  const media = header.id ? { id: header.id } : { link: header.url };

  return [
    {
      type: "header",
      parameters: [
        {
          type: header.type,
          [header.type]: media
        }
      ]
    }
  ];
}
