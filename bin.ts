import { expandGlob } from 'https://deno.land/std@0.99.0/fs/mod.ts';
import { dirname, basename } from 'https://deno.land/std@0.99.0/path/mod.ts';

type LineBlame = {
	file: string;
	line: number;
	info: CommitInfo;
};

type CommitInfo = {
	author: {
		name: string;
		email: string;
		date: Date;
	};
	committer: {
		name: string;
		email: string;
		date: Date;
	};
};

async function getBlameForFile(fileName: string): Promise<string> {
	const p = Deno.run({
		cmd: ['git', '--no-pager', 'blame', basename(fileName), '--porcelain'],
		cwd: dirname(fileName),
		stdout: 'piped',
		stderr: 'piped',
		stdin: 'null'
	});
	return new TextDecoder().decode(await p.output());
}

function spliceCommitInfoFromRawLines(rawLines: string[]): CommitInfo {
	const prefixes = [
		'author',
		'author-mail',
		'author-time',
		'author-tz',
		'committer',
		'committer-mail',
		'committer-time',
		'committer-tz',
		'summary',
		'previous',
		'filename'
	];
	const collected: Record<string, string> = {};
	for (let i = 0; i < prefixes.length; i++) {
		const expectedPrefix = prefixes[i];
		if (!rawLines[0].startsWith(expectedPrefix + ' ')) {
			continue;
			throw new Error(
				`Expected porcelain output to give data "${expectedPrefix}", but got: ${rawLines[0]}`
			);
		}
		collected[expectedPrefix] = (rawLines.shift() as string).substr(expectedPrefix.length + 1);
	}
	return {
		author: {
			name: collected['author'],
			email: collected['author-mail'],
			date: new Date(parseInt(collected['author-time'], 10) * 1000)
		},
		committer: {
			name: collected['committer'],
			email: collected['committer-mail'],
			date: new Date(parseInt(collected['committer-time'], 10) * 1000)
		}
	};
}
function parseLinesFromBlame(blame: string): Pick<LineBlame, 'info' | 'line'>[] {
	const rawLines = blame.split('\n');
	const parsedLines: Pick<LineBlame, 'info' | 'line'>[] = [];
	const commitInfoByHash: Record<string, CommitInfo> = {};
	while (rawLines.length > 1) {
		const [commitHash] = (rawLines.shift() as string).split(' ');
		if (!commitInfoByHash[commitHash]) {
			commitInfoByHash[commitHash] = spliceCommitInfoFromRawLines(rawLines);
		}
		parsedLines.push({
			line: parsedLines.length + 1,
			info: commitInfoByHash[commitHash]
		});

		// Not doing anything with the actual contents of the line
		if (rawLines.length) {
			rawLines.shift();
		}
	}
	return parsedLines;
}

function collectCommitsByDate(parsedLines: LineBlame[]): Record<string, LineBlame[]> {
	return parsedLines.reduce<Record<string, LineBlame[]>>((collected, line) => {
		const date = line.info.committer.date.toLocaleDateString('en-US');
		if (!collected[date]) {
			collected[date] = [];
		}
		collected[date].push(line);
		return collected;
	}, {});
}

async function createCsvForFiles(globPattern: string = '**/*.js'): Promise<string> {
	const lines: LineBlame[] = [];
	for await (const file of expandGlob(globPattern)) {
		const blame = await getBlameForFile(file.path);
		lines.splice(
			0,
			0,
			...parseLinesFromBlame(blame).map((line) => ({
				...line,
				file: file.path
			}))
		);
	}
	return lines
		.map((line) =>
			[
				line.file,
				line.line,
				line.info.committer.name,
				line.info.committer.email,
				line.info.committer.date.toLocaleDateString('en-US'),
				line.info.author.name,
				line.info.author.email,
				line.info.author.date.toLocaleDateString('en-US')
			].join(';')
		)
		.join('\n');
}

console.log(await createCsvForFiles());
