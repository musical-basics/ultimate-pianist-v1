import { redirect } from 'next/navigation'

export default function Page() {
    // If Supabase is configured, go to the normal library.
    // Otherwise, go to the offline demo.
    const hasSupabase = !!process.env.NEXT_PUBLIC_SUPABASE_URL
    redirect(hasSupabase ? '/learn' : '/demo')
}
