import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // 1. Get the auth token from the request header
    const authHeader = req.headers.get("Authorization")
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 2. Create a client with the user's token to verify their identity
    const supabaseUrl = Deno.env.get("SUPABASE_URL")
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // Create client with user's token to verify identity
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    // 3. Get the authenticated user
    const { data: { user }, error: authError } = await userClient.auth.getUser()
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 4. Verify the user has admin role
    const { data: userData, error: userError } = await userClient
      .from("users")
      .select("role")
      .eq("uid", user.id)
      .single()

    if (userError || !userData || userData.role !== "admin") {
      return new Response(
        JSON.stringify({ error: "Forbidden: admin role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 5. Parse the request body
    const body = await req.json()
    const { provider } = body

    if (!provider || !["supabase", "cloudinary"].includes(provider)) {
      return new Response(
        JSON.stringify({ error: "Invalid provider value. Must be 'supabase' or 'cloudinary'" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 6. Use service_role client to perform the update (bypasses RLS)
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey)

    const { error: updateError } = await serviceClient
      .from("system_settings")
      .upsert({
        key: "active_storage_provider",
        value: provider,
        description: "Active media storage provider: supabase or cloudinary",
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      }, { onConflict: "key" })

    if (updateError) {
      console.error("Update error:", updateError)
      return new Response(
        JSON.stringify({ error: "Failed to update storage provider: " + updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      )
    }

    // 7. Return success
    return new Response(
      JSON.stringify({ success: true, provider, message: `Storage provider set to ${provider}` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )

  } catch (error) {
    console.error("Edge function error:", error)
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    )
  }
})