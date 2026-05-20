interface AppLoadingScreenProps {
  variant: 'page' | 'panel';
}

export default function AppLoadingScreen({ variant }: AppLoadingScreenProps) {
  return (
    <div
      className={
        variant === 'page'
          ? 'min-h-screen bg-gray-50 flex items-center justify-center'
          : 'flex h-full items-center justify-center'
      }
    >
      <span
        className={`rounded-full border-4 border-[#800000]/15 border-t-[#800000] animate-spin ${
          variant === 'page' ? 'h-10 w-10' : 'h-8 w-8'
        }`}
      />
    </div>
  );
}
