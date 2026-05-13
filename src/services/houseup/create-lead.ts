type CreateHouseupLeadInput = {
  name: string | null;
  phone: string;
  source: string;
  interest: string | null;
  region: string | null;
  budget: number | null;
  paymentMethod: string | null;
  summary: string | null;
  brokerName?: string | null;
  brokerPhone?: string | null;
};

export async function createHouseupLead(input: CreateHouseupLeadInput) {
  const apiUrl = process.env.HOUSEUP_API_URL;
  const apiToken = process.env.HOUSEUP_API_TOKEN;

  if (!apiUrl || !apiToken) {
    return {
      ok: false,
      placeholder: true,
      externalId: null,
      payload: input,
      error: "HouseUp credentials are missing."
    };
  }

  return {
    ok: false,
    placeholder: true,
    externalId: null,
    payload: input,
    error: "HouseUp API real implementation is pending."
  };
}
