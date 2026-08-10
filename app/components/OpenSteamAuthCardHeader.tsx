import Image from 'next/image'

export function OpenSteamAuthBanner() {
  return (
    <div className="relative w-full aspect-[2.4/1] overflow-hidden bg-gradient-to-br from-indigo-950 via-slate-950 to-cyan-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_30%,rgba(99,102,241,0.45),transparent_55%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_70%,rgba(34,211,238,0.25),transparent_50%)]" />
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.35em] text-cyan-300/80">OpenSteam</p>
        <p className="mt-2 text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-lg">
          Manifest Platform
        </p>
      </div>
    </div>
  )
}

export function OpenSteamAuthLogo({ size = 'lg' }: { size?: 'md' | 'lg' }) {
  const dim = size === 'lg' ? 'h-28 w-28' : 'h-16 w-16'
  return (
    <Image
      src="/opensteam.png"
      alt="OpenSteam"
      width={112}
      height={112}
      className={`mx-auto ${dim} rounded-full object-contain shadow-lg shadow-cyan-500/20 ring-1 ring-cyan-400/30`}
      priority
    />
  )
}
