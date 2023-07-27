#!/bin/node

import { readdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { exec } from "node:child_process";
import { EOL } from "node:os";

const pexec = promisify(exec);

if (!process.argv.includes("--filter") || process.argv.includes("--help")) {
    console.log(`
pkgpush --filter {prefix} [--s3 {bucket}] [--publish]
- \`--filter\` - package prefix filter
- \`--s3\` - destination s3 bucket name, assumes you have the aws cli installed
- \`--publish\` - publish the package via \`npm publish --ignore-scripts\`
`);
}

const filter = process.argv[process.argv.indexOf("--filter") + 1];
const s3destination = process.argv.includes("--s3") ? process.argv[process.argv.indexOf("--s3") + 1] : false;
const shouldPublish = process.argv.includes("--publish");

async function* findProjectPackages(path) {
    const stats = await readdir(path, { withFileTypes: true });

    for (const stat of stats) {
        if (stat.isDirectory() && stat.name !== "node_modules") {
            for await (const v of findProjectPackages(path + "/" + stat.name)) {
                yield v;
            }
        }

        if (stat.isFile() && stat.name === "package.json") {
            yield path + "/" + stat.name;
        }
    }
}

function filterPredicate(deps) {
    return (dep) => dep.startsWith(filter) && !deps[dep].startsWith(".");
}

async function listDependencies(pkgFile) {
    const pkg = JSON.parse(await readFile(pkgFile, { encoding: "utf-8" }));

    const deps = new Set();

    if (pkg.dependencies) {
        Object.keys(pkg.dependencies).filter(filterPredicate(pkg.dependencies)).forEach(dep => deps.add(dep));
    }

    if (pkg.devDependencies) {
        Object.keys(pkg.devDependencies).filter(filterPredicate(pkg.devDependencies)).forEach(dep => deps.add(dep));
    }

    if (pkg.peerDependencies) {
        Object.keys(pkg.peerDependencies).filter(filterPredicate(pkg.peerDependencies)).forEach(dep => deps.add(dep));
    }

    return Array.from(deps);
}

const processedVersions = new Set();

for await (const pkgFile of findProjectPackages(process.cwd())) {
    const deps = await listDependencies(pkgFile);

    for (const dep of deps) {
        const depPath = new URL(`./node_modules/${dep}/`, "file://" + pkgFile);
        const depPkgFile = new URL("./package.json", depPath);

        let depPkg;

        try {
            depPkg = JSON.parse(await readFile(depPkgFile, {encoding: "utf-8"}));
        } catch(ex) {
            continue;
        }

        const prepName = `${dep.replace("@", "-").replace("/", "-")}-${depPkg.version}`;

        if (processedVersions.has(prepName)) {
            continue;
        }

        process.stdout.write(`${dep}: ${depPkg.version} ... `);

        if (depPkg.publishConfig && depPkg.publishConfig.registry) {
            delete depPkg.publishConfig.registry;

            await writeFile(depPkgFile, JSON.stringify(depPkg, undefined, 2), { encoding: "utf-8" });
        }

        process.stdout.write(" packing");

        const packResult = await pexec(`npm pack --ignore-scripts ${depPath.pathname}`);

        if (packResult.error) {
            console.error(packResult.error);
            throw packResult.error;
        }

        if (s3destination) {
            process.stdout.write(" uploading");

            const result = await pexec(`aws s3 cp ${prepName}.tgz s3://${s3destination}/${process.env.USERNAME || process.env.USER || "anon"}/${prepName}.tgz`)

            if (result.error) {
                console.error(result.error);
                throw result.error;
            }
        }

        if (shouldPublish) {
            process.stdout.write(" publishing");

            const result = await pexec(`npm publish --ignore-scripts ${prepName}.tgz`);

            if (result.error) {
                console.error(result.error);
                throw result.error;
            }
        }

        process.stdout.write(` done${EOL}`);

        processedVersions.add(prepName);
    }
}
