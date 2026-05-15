'use client'
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div style={{padding:20}}>
      <h3>Error caught</h3>
      <pre style={{fontSize:11,whiteSpace:'pre-wrap',maxHeight:400,overflow:'auto'}}>{error.message}{'\n\n'}{error.stack}</pre>
      <button onClick={reset}>Try again</button>
    </div>
  )
}
