'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export async function login(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    redirect('/login?message=Valid email and password required')
  }

  const { error } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    redirect(`/login?message=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/studio')
}

export async function signup(formData: FormData) {
  const supabase = await createClient()

  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    redirect('/login?message=Valid email and password required')
  }

  const { error } = await supabase.auth.signUp({
    email,
    password,
  })

  if (error) {
    redirect(`/login?message=${encodeURIComponent(error.message)}`)
  }

  revalidatePath('/', 'layout')
  redirect('/studio')
}

export async function adminLogin() {
  const supabase = await createClient()

  const email = 'admin@ultimatepianist.com'
  const password = 'AdminPassword123!'

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email,
    password,
  })

  if (signInError) {
    // If sign in fails, use service role to create an auto-confirmed user
    const adminAuthClient = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    await adminAuthClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    const { error: finalSignInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (finalSignInError) {
      redirect(`/login?message=${encodeURIComponent(finalSignInError.message)}`)
    }
  }

  revalidatePath('/', 'layout')
  redirect('/studio')
}
