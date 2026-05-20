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
  const parameters = Array.isArray(params)
    ? params
        .map((param) => (typeof param === "string" ? param.trim() : ""))
        .filter(Boolean)
        .map((param) => {
          const text = renderTemplate(param, {
            nome: contact.name,
            name: contact.name,
            telefone: contact.phone,
            phone: contact.phone
          });
          const namedParam = param.match(/^{{\s*([a-zA-Z0-9_]+)\s*}}$/);

          return {
            type: "text",
            ...(namedParam ? { parameter_name: namedParam[1] } : {}),
            text
          };
        })
    : [];

  if (parameters.length === 0) {
    return [];
  }

  return [
    {
      type: "body",
      parameters
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
