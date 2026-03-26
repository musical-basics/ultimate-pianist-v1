import { login, signup } from './actions'
import { Button } from '@/components/ui/button'

export default async function LoginPage(props: {
  searchParams: Promise<{ message?: string }>
}) {
  const searchParams = await props.searchParams

  return (
    <div className="flex-1 flex flex-col w-full px-8 sm:max-w-md justify-center gap-2 bg-zinc-950 min-h-screen text-white mx-auto">
      <div className="flex flex-col gap-2 text-center mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to Studio</h1>
        <p className="text-sm text-zinc-400">Sign in to manage your piano configurations.</p>
      </div>
      
      <form className="animate-in flex-1 flex flex-col w-full justify-center gap-2 text-zinc-300">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          className="rounded-md px-4 py-2 bg-zinc-900 border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-purple-500/50 mb-6 bg-inherit"
          name="email"
          placeholder="you@example.com"
          required
        />
        <label className="text-sm font-medium" htmlFor="password">
          Password
        </label>
        <input
          className="rounded-md px-4 py-2 bg-zinc-900 border border-zinc-800 focus:outline-none focus:ring-2 focus:ring-purple-500/50 mb-6 bg-inherit"
          type="password"
          name="password"
          placeholder="••••••••"
          required
        />
        <Button formAction={login} className="bg-purple-600 hover:bg-purple-700 text-white mb-2">
          Sign In
        </Button>
        <Button formAction={signup} variant="outline" className="text-zinc-300 border-zinc-800 hover:bg-zinc-800">
          Sign Up
        </Button>
        {searchParams?.message && (
          <p className="mt-4 p-3 bg-red-900/20 border border-red-900/50 text-red-400 text-sm text-center rounded-md">
            {searchParams.message}
          </p>
        )}
      </form>
    </div>
  )
}
