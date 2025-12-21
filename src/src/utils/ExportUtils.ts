/**
 * Utility functions for exporting data
 */

/**
 * Export data to a CSV file
 * @param {Array<Record<string, any>>} data - The data to export
 * @param {string} filename - The filename for the CSV
 */
export function exportToCsv(data: Record<string, any>[], filename: string): void {
  if (!data || !data.length) {
    console.warn("No data to export");
    return;
  }

  // Get headers from the first data object
  const headers = Object.keys(data[0]);

  // Create CSV rows
  const csvRows: string[] = [];

  // Add the headers
  csvRows.push(headers.join(","));

  // Add the data rows
  for (const row of data) {
    const values = headers.map((header) => {
      // Get the value and escape it if needed
      const value = row[header];
      let escapedValue = value === null || value === undefined ? "" : String(value);

      // Check if we need to quote the value
      if (escapedValue.includes(",") || escapedValue.includes('"') || escapedValue.includes("\n")) {
        // Escape quotes by doubling them
        escapedValue = escapedValue.replace(/"/g, '""');
        // Wrap in quotes
        escapedValue = `"${escapedValue}"`;
      }

      return escapedValue;
    });

    csvRows.push(values.join(","));
  }

  // Combine all rows into a single string
  const csvString = csvRows.join("\n");

  // Create a blob with the CSV data
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });

  // Create a download link
  const link = document.createElement("a");

  // Set the URL to a blob URL
  link.href = URL.createObjectURL(blob);

  // Set the download attribute to specify the filename
  link.setAttribute("download", filename);

  // Append the link to the body
  document.body.appendChild(link);

  // Click the link to trigger the download
  link.click();

  // Remove the link after the download starts
  document.body.removeChild(link);
}

/**
 * Format a timestamp for use in a filename
 * @returns {string} The formatted timestamp
 */
export function getTimestampForFilename(): string {
  const now = new Date();
  return now
    .toISOString()
    .replace(/[:.]/g, "-") // Replace colons and periods with hyphens
    .replace("T", "_") // Replace T with underscore
    .slice(0, 19); // Take only the date and time part
}
