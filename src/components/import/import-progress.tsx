"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react"

interface ImportProgressProps {
  progress: number
  done: boolean
  results: { success: number; errors: number; skipped: number; total: number }
  onReset: () => void
}

export function ImportProgress({ progress, done, results, onReset }: ImportProgressProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {done ? (
            <CheckCircle2 className="h-5 w-5 text-green-500" />
          ) : (
            <Loader2 className="h-5 w-5 animate-spin" />
          )}
          {done ? "Import Complete" : "Importing..."}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Progress value={done ? 100 : progress} />

        {done && (
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-green-500" />
              <span className="text-sm">{results.success} imported</span>
            </div>
            {results.skipped > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <span className="text-sm">{results.skipped} duplicates skipped</span>
              </div>
            )}
            {results.errors > 0 && (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive" />
                <span className="text-sm">{results.errors} errors</span>
              </div>
            )}
            <span className="text-sm text-muted-foreground">
              {results.total} total
            </span>
          </div>
        )}

        {done && (
          <Button onClick={onReset}>
            Import Another File
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
