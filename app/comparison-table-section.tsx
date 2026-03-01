import Link from "next/link"
import { ArrowRight } from "lucide-react"

const Check = () => (
    <div className="w-7 h-7 rounded-full bg-neutral-900 flex items-center justify-center">
        <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
    </div>
)

const Cross = () => (
    <svg className="w-5 h-5 text-neutral-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
)

type ComparisonRow = {
    feature: string
    dreamplay: string | "check"
    competitor: string | "cross"
}

const comparisonRows: ComparisonRow[] = [
    { feature: "Build Design", dreamplay: "Custom-Designed for Narrow Keys", competitor: "Generic OEM Adapted" },
    { feature: "Key Sensor Technology", dreamplay: "Dual Sensor", competitor: "Dual Sensor" },
    { feature: "Polyphony", dreamplay: "192 Notes", competitor: "192 Notes" },
    { feature: "LED Key Indicators", dreamplay: "check", competitor: "cross" },
    { feature: "App Integration", dreamplay: "check", competitor: "cross" },
    { feature: "MSRP Price", dreamplay: "$1,099", competitor: "$699 (Yamaha P125)" },
    { feature: "Bench & Stand", dreamplay: "Included", competitor: "Not Included" },
]

export function ComparisonTableSection() {
    return (
        <section className="relative overflow-hidden bg-white">
            <div className="mx-auto max-w-6xl px-6 py-20 md:py-28 lg:py-32">
                <div className="mb-16 max-w-2xl">
                    <p className="font-sans text-xs uppercase tracking-[0.3em] text-neutral-500">
                        Did You Know?
                    </p>
                    <h2 className="mt-4 font-serif text-3xl leading-tight text-neutral-900 md:text-4xl lg:text-5xl text-balance">
                        Why Pay Double for Less?
                    </h2>
                    <p className="mt-4 font-sans text-sm leading-relaxed text-neutral-500 md:text-base">
                        Compare our keyboard to our narrow-key competitors and see why musicians are making the switch.
                    </p>
                </div>

                {/* Comparison table */}
                <div className="max-w-4xl">
                    {/* Header */}
                    <div className="grid grid-cols-3 border-b border-neutral-200 border-t">
                        <div className="py-4 md:py-5 font-sans text-xs uppercase tracking-[0.2em] text-neutral-500 md:text-sm">
                            Feature
                        </div>
                        <div className="py-4 md:py-5 text-center font-sans text-xs uppercase tracking-[0.2em] text-neutral-900 font-medium md:text-sm">
                            DreamPlay
                        </div>
                        <div className="py-4 md:py-5 text-center font-sans text-xs uppercase tracking-[0.2em] text-neutral-400 md:text-sm">
                            Competitors
                        </div>
                    </div>

                    {/* Rows */}
                    {comparisonRows.map((row) => (
                        <div
                            key={row.feature}
                            className="grid grid-cols-3 border-b border-neutral-200"
                        >
                            <div className="py-5 md:py-6 font-sans text-sm text-neutral-900 md:text-base">
                                {row.feature}
                            </div>
                            <div className="py-5 md:py-6 text-center flex justify-center items-center">
                                {row.dreamplay === "check" ? (
                                    <Check />
                                ) : (
                                    <span className="font-sans text-sm font-medium text-neutral-900 md:text-base">{row.dreamplay}</span>
                                )}
                            </div>
                            <div className="py-5 md:py-6 text-center flex justify-center items-center">
                                {row.competitor === "cross" ? (
                                    <Cross />
                                ) : (
                                    <span className="font-sans text-sm text-neutral-400 md:text-base">{row.competitor}</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>

                {/* CTA */}
                <div className="mt-12 md:mt-16">
                    <Link
                        href="/customize"
                        className="group inline-flex items-center justify-center gap-2 border border-neutral-900 bg-neutral-900 px-8 py-4 font-sans text-xs uppercase tracking-widest text-white transition-colors hover:bg-neutral-800"
                    >
                        Get Premium Quality for Less
                        <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-1" />
                    </Link>
                </div>
            </div>
        </section>
    )
}
