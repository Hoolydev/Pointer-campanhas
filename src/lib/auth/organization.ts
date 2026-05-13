import type { SupabaseClient } from "@supabase/supabase-js";

export type CurrentProfile = {
  id: string;
  organization_id: string;
  full_name: string | null;
  role: "admin" | "manager" | "broker" | "user";
};

export async function getCurrentProfile(supabase: SupabaseClient) {
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { profile: null, error: "Sessao invalida. Entre novamente." };
  }

  const selectedColumns = "id, organization_id, full_name, role";
  const { data: profile, error } = await supabase
    .from("profiles")
    .select(selectedColumns)
    .eq("id", user.id)
    .maybeSingle<CurrentProfile>();

  if (profile) {
    return { profile, error: null };
  }

  if (error) {
    return {
      profile: null,
      error: error.message
    };
  }

  const { data: bootstrappedProfile, error: bootstrapError } = await supabase
    .rpc("bootstrap_current_user_organization", {
      input_organization_name: user.user_metadata?.organization_name ?? null,
      input_full_name: user.user_metadata?.full_name ?? user.email ?? null
    })
    .maybeSingle<CurrentProfile>();

  if (bootstrapError || !bootstrappedProfile) {
    return {
      profile: null,
      error:
        bootstrapError?.message ??
        "Nao foi possivel criar automaticamente seu perfil e organizacao."
    };
  }

  return { profile: bootstrappedProfile, error: null };
}
