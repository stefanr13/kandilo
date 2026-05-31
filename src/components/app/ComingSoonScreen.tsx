import { Church } from 'lucide-react';

export default function ComingSoonScreen() {
  return (
    <main className="min-h-screen bg-[#F9F9F9] px-6 py-8 text-gray-900">
      <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-3xl flex-col justify-between">
        <header className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#800000] text-white shadow-lg shadow-red-900/15">
            <Church size={22} />
          </div>
          <div>
            <p className="text-sm font-black tracking-tight">Kandilo</p>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#937022]">
              Parish life, simplified
            </p>
          </div>
        </header>

        <section className="py-16">
          <p className="mb-4 text-[10px] font-black uppercase tracking-[0.25em] text-[#937022]">
            Coming soon
          </p>
          <h1 className="max-w-2xl text-5xl font-black leading-none tracking-tight text-gray-950 sm:text-7xl">
            Kandilo is preparing for launch.
          </h1>
          <p className="mt-6 max-w-xl text-base font-medium leading-7 text-gray-500">
            We are finishing production setup before opening the app to parishes and donors.
          </p>
        </section>

        <footer className="border-t border-gray-200 py-6 text-sm font-bold text-gray-500">
          <span>Official access will be available here once launch setup is complete.</span>
        </footer>
      </div>
    </main>
  );
}
