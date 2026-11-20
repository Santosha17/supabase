import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  try {
    // 1. Receber o Webhook da Base de Dados (INSERT on notifications)
    const payload = await req.json()
    const record = payload.record // O novo registo na tabela notifications

    if (!record || !record.user_id) {
      return new Response("No record found", { status: 400 })
    }

    // 2. Inicializar o Supabase com Service Role para poder ler dados protegidos
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 3. Obter o expo_push_token do utilizador
    // NOTA: Se usas a tabela auth.users.user_metadata, descomenta a linha A e comenta a linha B.
    // Como sugeri adicionar na tabela profiles, usamos a linha B.

    // A) LER DE AUTH.USERS:
    // const { data: { user }, error: userError } = await supabase.auth.admin.getUserById(record.user_id);
    // const pushToken = user?.user_metadata?.expo_push_token;

    // B) LER DA TABELA PROFILES (Se adicionaste a coluna lá)
    const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('user_metadata') // ou select('expo_push_token') se criaste a coluna diretamente
        .eq('id', record.user_id)
        .single()

    let pushToken = null;
    // Tenta ler caso seja uma coluna JSONB ou coluna normal
    if (profile?.expo_push_token) {
      pushToken = profile.expo_push_token;
    } else if (profile?.user_metadata?.expo_push_token) {
      pushToken = profile.user_metadata.expo_push_token;
    }

    if (!pushToken) {
      return new Response("User has no push token", { status: 200 })
    }

    // 4. Determinar a Rota para Deep Linking com base no tipo
    let route = '/(public)/notifications'; // Rota padrão
    if (record.type === 'match_update') {
      route = '/(public)/(tabs)/favorites';
    } else if (record.type === 'friend_request' || record.type === 'friend_activity') {
      route = '/(public)/friends';
    }

    // 5. Enviar para a API do Expo Push
    const expoResponse = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: pushToken,
        sound: 'default',
        title: record.title,
        body: record.message,
        data: {
          route: route, // É isto que permite à app navegar quando clicas na notificação
          type: record.type,
          ...record.data
        },
      }),
    })

    const expoResult = await expoResponse.json()
    return new Response(JSON.stringify(expoResult), { headers: { 'Content-Type': 'application/json' } })

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 })
  }
})